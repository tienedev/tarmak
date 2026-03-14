use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use serde::Serialize;

use crate::db::Db;
use crate::db::models::{Board, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// ---- Request bodies --------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateBoard {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateBoard {
    pub name: Option<String>,
    pub description: Option<String>,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<Board>>, ApiError> {
    let boards = db.list_user_boards(&user.id)?;
    Ok(Json(boards))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Json(body): Json<CreateBoard>,
) -> Result<Json<Board>, ApiError> {
    let board = db.create_board(&body.name, body.description.as_deref())?;
    db.add_board_member(&board.id, &user.id, Role::Owner)?;
    Ok(Json(board))
}

pub async fn get(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Viewer)?;
    let board = db
        .get_board(&id)?
        .ok_or_else(|| anyhow::anyhow!("board not found"))?;
    Ok(Json(board))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateBoard>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Owner)?;
    let description = body.description.as_ref().map(|d| Some(d.as_str()));
    let board = db
        .update_board(&id, body.name.as_deref(), description)?
        .ok_or_else(|| anyhow::anyhow!("board not found"))?;
    Ok(Json(board))
}

#[derive(Serialize)]
pub struct MemberResponse {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub role: Role,
}

pub async fn members(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Vec<MemberResponse>>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Viewer)?;
    let members = db.list_board_members(&id)?;
    let resp: Vec<MemberResponse> = members
        .into_iter()
        .map(|(u, role)| MemberResponse {
            id: u.id,
            name: u.name,
            email: u.email,
            avatar_url: u.avatar_url,
            role,
        })
        .collect();
    Ok(Json(resp))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Owner)?;
    let deleted = db.delete_board(&id)?;
    if !deleted {
        return Err(anyhow::anyhow!("board not found").into());
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}
