use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Comment, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// ---- Request bodies --------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateComment {
    pub content: String,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<Vec<Comment>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let comments = db.list_comments(&tid).await?;
    Ok(Json(comments))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<CreateComment>,
) -> Result<Json<Comment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db.create_comment(&tid, &user.id, &body.content).await?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "comment_added",
        Some(&serde_json::json!({"task_id": &tid}).to_string())).await;
    Ok(Json(comment))
}
