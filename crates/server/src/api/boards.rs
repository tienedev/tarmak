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
use super::validation;

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

#[derive(Deserialize)]
pub struct DuplicateBoardBody {
    pub name: String,
    pub include_tasks: Option<bool>,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<Board>>, ApiError> {
    let boards = db.list_user_boards(&user.id).await?;
    Ok(Json(boards))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Json(body): Json<CreateBoard>,
) -> Result<Json<Board>, ApiError> {
    validation::validate_title(&body.name)?;
    let board = db.create_board(&body.name, body.description.as_deref()).await?;
    db.add_board_member(&board.id, &user.id, Role::Owner).await?;
    Ok(Json(board))
}

pub async fn get(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Viewer).await?;
    let board = db
        .get_board(&id)
        .await?
        .ok_or_else(|| ApiError::NotFound("board not found".into()))?;
    Ok(Json(board))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateBoard>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &id, &user.id, Role::Owner).await?;
    let description = body.description.as_ref().map(|d| Some(d.as_str()));
    let board = db
        .update_board(&id, body.name.as_deref(), description)
        .await?
        .ok_or_else(|| ApiError::NotFound("board not found".into()))?;
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
    permissions::require_role(&db, &id, &user.id, Role::Viewer).await?;
    let members = db.list_board_members(&id).await?;
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
    permissions::require_role(&db, &id, &user.id, Role::Owner).await?;
    let deleted = db.delete_board(&id).await?;
    if !deleted {
        return Err(ApiError::NotFound("board not found".into()));
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub async fn duplicate(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<DuplicateBoardBody>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    validation::validate_title(&body.name)?;
    let include_tasks = body.include_tasks.unwrap_or(true);
    let board = db.duplicate_board(&board_id, &body.name, include_tasks, &user.id).await?;
    let _ = db.log_activity(
        &board.id,
        None,
        &user.id,
        "board_duplicated",
        Some(&serde_json::json!({"source_board_id": board_id}).to_string()),
    ).await;
    Ok(Json(board))
}
