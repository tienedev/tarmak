use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{CustomField, FieldType, Role, TaskCustomFieldValue};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// ---- Request bodies --------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateField {
    pub name: String,
    pub field_type: FieldType,
}

#[derive(Deserialize)]
pub struct SetFieldValue {
    pub value: String,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<CustomField>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let fields = db.list_custom_fields(&board_id)?;
    Ok(Json(fields))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateField>,
) -> Result<Json<CustomField>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let field = db.create_custom_field(&board_id, &body.name, body.field_type, None)?;
    let _ = db.log_activity(&board_id, None, &user.id, "field_created",
        Some(&serde_json::json!({"name": &field.name}).to_string()));
    Ok(Json(field))
}

pub async fn get_values(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<Vec<TaskCustomFieldValue>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let values = db.get_custom_field_values(&tid)?;
    Ok(Json(values))
}

pub async fn set_value(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, fid)): Path<(String, String, String)>,
    Json(body): Json<SetFieldValue>,
) -> Result<Json<TaskCustomFieldValue>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    // Verify task belongs to this board
    let task = db
        .get_task(&tid)?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    // Verify field belongs to this board
    let fields = db.list_custom_fields(&board_id)?;
    if !fields.iter().any(|f| f.id == fid) {
        return Err(ApiError::NotFound("field not found".into()));
    }
    let value = db.set_custom_field_value(&tid, &fid, &body.value)?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "field_value_set",
        Some(&serde_json::json!({"field_id": &fid, "value": &body.value}).to_string()));
    Ok(Json(value))
}
