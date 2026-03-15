use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Label, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// Color validation: must be #RRGGBB hex
fn is_valid_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Deserialize)]
pub struct CreateLabel {
    pub name: String,
    pub color: String,
}

#[derive(Deserialize)]
pub struct UpdateLabel {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct AttachLabel {
    pub label_id: String,
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<Label>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let labels = db.list_labels(&board_id)?;
    Ok(Json(labels))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateLabel>,
) -> Result<Json<Label>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    if body.name.trim().is_empty() || body.name.len() > 50 {
        return Err(ApiError::BadRequest("label name must be 1-50 characters".into()));
    }
    if !is_valid_color(&body.color) {
        return Err(ApiError::BadRequest("color must be #RRGGBB hex format".into()));
    }
    let label = db.create_label(&board_id, body.name.trim(), &body.color)?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_created",
        Some(&serde_json::json!({"name": &label.name, "color": &label.color}).to_string()),
    );
    Ok(Json(label))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, label_id)): Path<(String, String)>,
    Json(body): Json<UpdateLabel>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("label not found".into()));
    }
    if let Some(ref c) = body.color {
        if !is_valid_color(c) {
            return Err(ApiError::BadRequest("color must be #RRGGBB hex format".into()));
        }
    }
    db.update_label(&label_id, body.name.as_deref(), body.color.as_deref())?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_updated",
        Some(&serde_json::json!({"name": existing.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"updated": true})))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, label_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("label not found".into()));
    }
    db.delete_label(&label_id)?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_deleted",
        Some(&serde_json::json!({"name": existing.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"deleted": true})))
}

pub async fn attach(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
    Json(body): Json<AttachLabel>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let label = db.get_label(&body.label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if label.board_id != board_id { return Err(ApiError::NotFound("label not found".into())); }
    db.add_task_label(&task_id, &body.label_id)?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "label_added",
        Some(&serde_json::json!({"task_title": task.title, "label_name": label.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn detach(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, label_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let label = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    db.remove_task_label(&task_id, &label_id)?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "label_removed",
        Some(&serde_json::json!({"task_title": task.title, "label_name": label.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"ok": true})))
}
