use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Priority, Role, Task};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// ---- Request bodies --------------------------------------------------------

fn default_priority() -> Priority {
    Priority::Medium
}

#[derive(Deserialize)]
pub struct CreateTask {
    pub column_id: String,
    pub title: String,
    #[serde(default = "default_priority")]
    pub priority: Priority,
}

#[derive(Deserialize)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub priority: Option<Priority>,
    pub assignee: Option<Option<String>>,
}

#[derive(Deserialize)]
pub struct MoveTask {
    pub column_id: String,
    pub position: i64,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<Task>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let tasks = db.list_tasks(&board_id)?;
    Ok(Json(tasks))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.create_task(
        &board_id,
        &body.column_id,
        &body.title,
        None,
        body.priority,
        None,
    )?;
    let _ = db.log_activity(
        &board_id,
        Some(&task.id),
        &user.id,
        "task_created",
        Some(&serde_json::json!({"title": &task.title}).to_string()),
    );
    Ok(Json(task))
}

pub async fn get(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let task = db
        .get_task(&tid)?
        .ok_or_else(|| anyhow::anyhow!("task not found"))?;
    if task.board_id != board_id {
        return Err(anyhow::anyhow!("task not found").into());
    }
    Ok(Json(task))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<UpdateTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| anyhow::anyhow!("task not found"))?;
    if existing.board_id != board_id {
        return Err(anyhow::anyhow!("task not found").into());
    }
    let description = body.description.as_ref().map(|d| d.as_deref());
    let assignee = body.assignee.as_ref().map(|a| a.as_deref());
    let task = db
        .update_task(
            &tid,
            body.title.as_deref(),
            description,
            body.priority,
            assignee,
        )?
        .ok_or_else(|| anyhow::anyhow!("task not found"))?;
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_updated",
        Some(&serde_json::json!({"title": &task.title}).to_string()),
    );
    Ok(Json(task))
}

pub async fn move_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<MoveTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| anyhow::anyhow!("task not found"))?;
    if existing.board_id != board_id {
        return Err(anyhow::anyhow!("task not found").into());
    }
    let task = db
        .move_task(&tid, &body.column_id, body.position)?
        .ok_or_else(|| anyhow::anyhow!("task not found"))?;
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_moved",
        Some(&serde_json::json!({"title": &task.title, "to_column_id": &body.column_id}).to_string()),
    );
    Ok(Json(task))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| anyhow::anyhow!("task not found"))?;
    if existing.board_id != board_id {
        return Err(anyhow::anyhow!("task not found").into());
    }
    let deleted = db.delete_task(&tid)?;
    if !deleted {
        return Err(anyhow::anyhow!("task not found").into());
    }
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_deleted",
        Some(&serde_json::json!({"title": &existing.title}).to_string()),
    );
    Ok(Json(serde_json::json!({ "deleted": true })))
}
