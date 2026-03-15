use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use std::collections::HashMap;

use crate::db::Db;
use crate::db::models::{Priority, Role, SubtaskCount, Task, TaskWithRelations};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use super::validation;

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
    pub due_date: Option<Option<String>>,
}

#[derive(Deserialize)]
pub struct MoveTask {
    pub column_id: String,
    pub position: i64,
}

#[derive(Deserialize)]
pub struct ListTasksParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ---- Handlers --------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Query(params): Query<ListTasksParams>,
) -> Result<Json<Vec<TaskWithRelations>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let limit = params.limit.unwrap_or(100).min(500);
    let offset = params.offset.unwrap_or(0).max(0);
    let tasks = db.list_tasks(&board_id, limit, offset)?;

    // Batch load labels and subtask counts
    let label_pairs = db.get_labels_for_board_tasks(&board_id)?;
    let mut labels_by_task: HashMap<String, Vec<_>> = HashMap::new();
    for (task_id, label) in label_pairs {
        labels_by_task.entry(task_id).or_default().push(label);
    }

    let subtask_counts = db.get_subtask_counts_for_board(&board_id)?;
    let mut counts_by_task: HashMap<String, SubtaskCount> = HashMap::new();
    for (task_id, count) in subtask_counts {
        counts_by_task.insert(task_id, count);
    }

    let result: Vec<TaskWithRelations> = tasks
        .into_iter()
        .map(|task| {
            let labels = labels_by_task.remove(&task.id).unwrap_or_default();
            let subtask_count = counts_by_task.remove(&task.id).unwrap_or(SubtaskCount { completed: 0, total: 0 });
            TaskWithRelations { task, labels, subtask_count }
        })
        .collect();

    Ok(Json(result))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    validation::validate_title(&body.title)?;
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
) -> Result<Json<TaskWithRelations>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let task = db
        .get_task(&tid)?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let labels = db.get_task_labels(&tid)?;
    let subtasks = db.list_subtasks(&tid)?;
    let subtask_count = SubtaskCount {
        completed: subtasks.iter().filter(|s| s.completed).count() as i32,
        total: subtasks.len() as i32,
    };
    Ok(Json(TaskWithRelations { task, labels, subtask_count }))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<UpdateTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let description = body.description.as_ref().map(|d| d.as_deref());
    let assignee = body.assignee.as_ref().map(|a| a.as_deref());
    let due_date = body.due_date.as_ref().map(|d| d.as_deref());
    let task = db
        .update_task(
            &tid,
            body.title.as_deref(),
            description,
            body.priority,
            assignee,
            due_date,
        )?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    let _ = db.log_activity(
        &board_id,
        Some(&tid),
        &user.id,
        "task_updated",
        Some(&serde_json::json!({"title": &task.title}).to_string()),
    );
    // Log due_date changes
    if body.due_date.is_some() {
        let action = if task.due_date.is_some() { "due_date_set" } else { "due_date_removed" };
        let details = if let Some(ref d) = task.due_date {
            serde_json::json!({"task_title": &task.title, "due_date": d})
        } else {
            serde_json::json!({"task_title": &task.title})
        };
        let _ = db.log_activity(&board_id, Some(&tid), &user.id, action, Some(&details.to_string()));
    }
    Ok(Json(task))
}

pub async fn move_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<MoveTask>,
) -> Result<Json<Task>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let task = db
        .move_task(&tid, &body.column_id, body.position)?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
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
    let existing = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let deleted = db.delete_task(&tid)?;
    if !deleted {
        return Err(ApiError::NotFound("task not found".into()));
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
