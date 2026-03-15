use axum::{
    Json,
    extract::{Path, State},
};

use crate::db::Db;
use crate::db::models::Role;
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

pub async fn archive_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db
        .get_task(&tid)?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    db.archive_task(&tid)?;
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_archived",
        Some(&serde_json::json!({"task_title": &existing.title}).to_string()),
    );
    Ok(Json(serde_json::json!({ "archived": true })))
}

pub async fn unarchive_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db
        .get_task(&tid)?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    db.unarchive_task(&tid)?;
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_unarchived",
        Some(&serde_json::json!({"task_title": &existing.title}).to_string()),
    );
    Ok(Json(serde_json::json!({ "unarchived": true })))
}

pub async fn archive_column(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let columns = db.list_columns(&board_id)?;
    if !columns.iter().any(|c| c.id == cid) {
        return Err(ApiError::NotFound("column not found".into()));
    }
    let task_count = db.archive_column(&cid)?;
    let _ = db.log_activity(
        &board_id,
        None,
        &user.id,
        "column_archived",
        Some(&serde_json::json!({"column_id": &cid, "task_count": task_count}).to_string()),
    );
    Ok(Json(serde_json::json!({ "archived": true, "task_count": task_count })))
}

pub async fn unarchive_column(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let (_, archived_cols) = db.list_archived(&board_id)?;
    if !archived_cols.iter().any(|c| c.id == cid) {
        return Err(ApiError::NotFound("archived column not found".into()));
    }
    let task_count = db.unarchive_column(&cid)?;
    let _ = db.log_activity(
        &board_id,
        None,
        &user.id,
        "column_unarchived",
        Some(&serde_json::json!({"column_id": &cid, "task_count": task_count}).to_string()),
    );
    Ok(Json(serde_json::json!({ "unarchived": true, "task_count": task_count })))
}

pub async fn list_archived(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let (tasks, columns) = db.list_archived(&board_id)?;
    Ok(Json(serde_json::json!({ "tasks": tasks, "columns": columns })))
}
