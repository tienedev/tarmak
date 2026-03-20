use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use crate::db::Db;
use crate::db::models::{Role, Subtask};

#[derive(Deserialize)]
pub struct CreateSubtask {
    pub title: String,
}

#[derive(Deserialize)]
pub struct UpdateSubtask {
    pub title: Option<String>,
    pub completed: Option<bool>,
    pub position: Option<i32>,
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
) -> Result<Json<Vec<Subtask>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let task = db
        .get_task(&task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let subtasks = db.list_subtasks(&task_id).await?;
    Ok(Json(subtasks))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
    Json(body): Json<CreateSubtask>,
) -> Result<Json<Subtask>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let task = db
        .get_task(&task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    if body.title.trim().is_empty() || body.title.len() > 200 {
        return Err(ApiError::BadRequest(
            "subtask title must be 1-200 characters".into(),
        ));
    }
    let subtask = db.create_subtask(&task_id, body.title.trim()).await?;
    let _ = db
        .log_activity(
            &board_id,
            Some(&task_id),
            &user.id,
            "subtask_created",
            Some(
                &serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title})
                    .to_string(),
            ),
        )
        .await;
    Ok(Json(subtask))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, subtask_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateSubtask>,
) -> Result<Json<Subtask>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let task = db
        .get_task(&task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let existing = db
        .get_subtask(&subtask_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;
    if existing.task_id != task_id {
        return Err(ApiError::NotFound("subtask not found".into()));
    }

    let was_completed = existing.completed;
    let subtask = db
        .update_subtask(
            &subtask_id,
            body.title.as_deref(),
            body.completed,
            body.position,
        )
        .await?
        .ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;

    // Log completion/uncompletion
    if let Some(completed) = body.completed {
        if completed && !was_completed {
            let _ = db.log_activity(
                &board_id, Some(&task_id), &user.id, "subtask_completed",
                Some(&serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title}).to_string()),
            ).await;
        } else if !completed && was_completed {
            let _ = db.log_activity(
                &board_id, Some(&task_id), &user.id, "subtask_uncompleted",
                Some(&serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title}).to_string()),
            ).await;
        }
    }

    Ok(Json(subtask))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, subtask_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let task = db
        .get_task(&task_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }
    let existing = db
        .get_subtask(&subtask_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;
    if existing.task_id != task_id {
        return Err(ApiError::NotFound("subtask not found".into()));
    }
    db.delete_subtask(&subtask_id).await?;
    let _ = db
        .log_activity(
            &board_id,
            Some(&task_id),
            &user.id,
            "subtask_deleted",
            Some(
                &serde_json::json!({"task_title": task.title, "subtask_title": existing.title})
                    .to_string(),
            ),
        )
        .await;
    Ok(Json(serde_json::json!({"deleted": true})))
}
