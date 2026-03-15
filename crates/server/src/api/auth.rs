use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::auth;
use crate::db::Db;
use crate::db::models::User;

use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use super::validation;

// ---------------------------------------------------------------------------
// Request / Response bodies
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct InviteRequest {
    pub board_id: String,
    pub role: String,
}

#[derive(Deserialize)]
pub struct AcceptRequest {
    pub invite_token: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: User,
}

#[derive(Serialize)]
pub struct InviteResponse {
    pub invite_url: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// Register a new user. Creates the user and a session.
pub async fn register(
    State(db): State<Db>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    validation::validate_name(&body.name)?;
    validation::validate_email(&body.email)?;
    validation::validate_password(&body.password)?;

    if let Some(_existing) = db.get_user_by_email(&body.email)? {
        return Err(anyhow::anyhow!("user with this email already exists").into());
    }

    let password_hash = auth::hash_password(&body.password)?;
    let user = db.create_user(&body.name, &body.email, None, false, Some(&password_hash))?;
    let token = auth::create_session(&db, &user.id)?;

    Ok(Json(AuthResponse { token, user }))
}

/// Login with email and password. Creates a new session.
pub async fn login(
    State(db): State<Db>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    validation::validate_email(&body.email)?;

    let user = db
        .get_user_by_email(&body.email)?
        .ok_or_else(|| anyhow::anyhow!("invalid email or password"))?;

    let hash = db.get_password_hash(&user.id)?
        .ok_or_else(|| anyhow::anyhow!("invalid email or password"))?;

    if !auth::verify_password(&body.password, &hash)? {
        return Err(anyhow::anyhow!("invalid email or password").into());
    }

    let token = auth::create_session(&db, &user.id)?;
    Ok(Json(AuthResponse { token, user }))
}

/// Create an invite link for a board (protected endpoint, requires Owner role).
pub async fn invite(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Json(body): Json<InviteRequest>,
) -> Result<Json<InviteResponse>, ApiError> {
    // Only owners can create invites
    permissions::require_role(&db, &body.board_id, &user.id, crate::db::models::Role::Owner)?;

    // Validate role
    let valid_roles = ["owner", "member", "viewer"];
    if !valid_roles.contains(&body.role.as_str()) {
        return Err(anyhow::anyhow!("invalid role: must be owner, member, or viewer").into());
    }

    let invite_token =
        auth::create_invite_link(&db, &body.board_id, &body.role, &user.id)?;

    let invite_url = format!("/invite/{invite_token}");
    Ok(Json(InviteResponse { invite_url }))
}

/// Accept an invite link, adding the authenticated user to the board.
pub async fn accept(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Json(body): Json<AcceptRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let board_id = db.with_conn(|conn| {
        conn.query_row(
            "SELECT board_id FROM invite_links WHERE token = ?1",
            rusqlite::params![crate::auth::hash_token(&body.invite_token)],
            |row| row.get::<_, String>(0),
        ).map_err(|e| anyhow::anyhow!("invite lookup: {e}"))
    }).ok();

    auth::accept_invite(&db, &body.invite_token, &user.id)?;

    if let Some(bid) = board_id {
        let _ = db.log_activity(&bid, None, &user.id, "member_joined", None);
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Return the currently authenticated user.
pub async fn me(AuthUser(user): AuthUser) -> Result<Json<User>, ApiError> {
    Ok(Json(user))
}

// ---------------------------------------------------------------------------
// Invite management
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct InviteLinkInfo {
    pub id: String,
    pub board_id: String,
    pub role: String,
    pub token: String,
    pub expires_at: String,
    pub created_by: String,
}

/// List active (non-expired) invite links for a board (requires auth + membership).
pub async fn list_invites(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Result<Json<Vec<InviteLinkInfo>>, ApiError> {
    let board_id = params
        .get("board_id")
        .ok_or_else(|| anyhow::anyhow!("board_id query param required"))?;

    permissions::require_role(&db, board_id, &user.id, crate::db::models::Role::Viewer)?;

    let now = chrono::Utc::now().to_rfc3339();
    let invites = db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board_id, role, token, expires_at, created_by
             FROM invite_links
             WHERE board_id = ?1 AND expires_at > ?2
             ORDER BY expires_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![board_id, now], |row| {
            let raw_hash: String = row.get(3)?;
            Ok(InviteLinkInfo {
                id: row.get(0)?,
                board_id: row.get(1)?,
                role: row.get(2)?,
                token: format!("{}...", &raw_hash[..8.min(raw_hash.len())]),
                expires_at: row.get(4)?,
                created_by: row.get(5)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    })?;

    Ok(Json(invites))
}

/// Revoke (delete) an invite link by ID (requires auth + Owner role on the board).
pub async fn revoke_invite(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    axum::extract::Path(invite_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Look up the invite's board to verify ownership.
    let board_id: String = db.with_conn(|conn| {
        conn.query_row(
            "SELECT board_id FROM invite_links WHERE id = ?1",
            rusqlite::params![invite_id],
            |row| row.get(0),
        ).map_err(|_| anyhow::anyhow!("invite not found"))
    })?;

    permissions::require_role(&db, &board_id, &user.id, crate::db::models::Role::Owner)?;

    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM invite_links WHERE id = ?1",
            rusqlite::params![invite_id],
        )?;
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
