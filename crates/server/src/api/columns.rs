use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Column, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// ---- Request bodies --------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateColumn {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateColumn {
    pub name: Option<String>,
    pub wip_limit: Option<Option<i64>>,
    pub color: Option<Option<String>>,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<Column>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let columns = db.list_columns(&board_id)?;
    Ok(Json(columns))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateColumn>,
) -> Result<Json<Column>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let column = db.create_column(&board_id, &body.name, None, body.color.as_deref())?;
    let _ = db.log_activity(&board_id, None, &user.id, "column_created",
        Some(&serde_json::json!({"name": &column.name}).to_string()));
    Ok(Json(column))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
    Json(body): Json<UpdateColumn>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let color = body.color.as_ref().map(|c| c.as_deref());
    let updated = db.update_column(&cid, body.name.as_deref(), body.wip_limit, color)?;
    if !updated {
        return Err(anyhow::anyhow!("column not found").into());
    }
    let _ = db.log_activity(&board_id, None, &user.id, "column_updated",
        Some(&serde_json::json!({"column_id": &cid}).to_string()));
    Ok(Json(serde_json::json!({ "updated": true })))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let deleted = db.delete_column(&cid)?;
    if !deleted {
        return Err(anyhow::anyhow!("column not found").into());
    }
    let _ = db.log_activity(&board_id, None, &user.id, "column_deleted",
        Some(&serde_json::json!({"column_id": &cid}).to_string()));
    Ok(Json(serde_json::json!({ "deleted": true })))
}
