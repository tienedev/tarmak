use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde::Deserialize;

use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use crate::db::Db;
use crate::db::models::{Comment, Role};
use crate::notifications::{self, NotifTx, parse_mentions};

// ---- Request bodies --------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateComment {
    pub content: String,
}

#[derive(Deserialize)]
pub struct UpdateComment {
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
    Extension(tx): Extension<NotifTx>,
    Path((board_id, tid)): Path<(String, String)>,
    Json(body): Json<CreateComment>,
) -> Result<Json<Comment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db.create_comment(&tid, &user.id, &body.content).await?;
    let _ = db
        .log_activity(
            &board_id,
            Some(&tid),
            &user.id,
            "comment_added",
            Some(&serde_json::json!({"task_id": &tid}).to_string()),
        )
        .await;

    // Trigger comment + mention notifications
    let task = db
        .get_task(&tid)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    let mentioned_ids = parse_mentions(&body.content);

    // Notify task participants (assignee + previous commenters), excluding author
    let participants = db.get_task_participant_ids(&tid).await.unwrap_or_default();
    for pid in &participants {
        if pid == &user.id {
            continue;
        }
        // If user is mentioned, they get a mention notif instead of comment notif
        if mentioned_ids.contains(pid) {
            continue;
        }
        let title = format!("{} commented on \"{}\"", user.name, task.title);
        if let Ok(notif) = db
            .create_notification(pid, &board_id, Some(&tid), "comment", &title, None)
            .await
        {
            notifications::broadcast(&tx, &notif);
        }
    }

    // Mention notifications
    for mid in &mentioned_ids {
        if mid == &user.id {
            continue;
        }
        let title = format!("{} mentioned you in \"{}\"", user.name, task.title);
        if let Ok(notif) = db
            .create_notification(mid, &board_id, Some(&tid), "mention", &title, None)
            .await
        {
            notifications::broadcast(&tx, &notif);
        }
    }

    Ok(Json(comment))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Extension(tx): Extension<NotifTx>,
    Path((board_id, tid, cid)): Path<(String, String, String)>,
    Json(body): Json<UpdateComment>,
) -> Result<Json<Comment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db
        .get_comment(&cid)
        .await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    if comment.user_id != user.id {
        return Err(ApiError::Forbidden("not the comment author".into()));
    }
    let old_mentions = parse_mentions(&comment.content);
    let updated = db
        .update_comment(&cid, &body.content)
        .await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    let _ = db
        .log_activity(
            &board_id,
            Some(&tid),
            &user.id,
            "comment_updated",
            Some(&serde_json::json!({"task_id": &tid, "comment_id": &cid}).to_string()),
        )
        .await;

    // Notify newly mentioned users (skip self and previously mentioned)
    let new_mentions = parse_mentions(&body.content);
    let task = db
        .get_task(&tid)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    for mid in &new_mentions {
        if mid == &user.id || old_mentions.contains(mid) {
            continue;
        }
        let title = format!("{} mentioned you in \"{}\"", user.name, task.title);
        if let Ok(notif) = db
            .create_notification(mid, &board_id, Some(&tid), "mention", &title, None)
            .await
        {
            notifications::broadcast(&tx, &notif);
        }
    }

    Ok(Json(updated))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, cid)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db
        .get_comment(&cid)
        .await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    if comment.user_id != user.id {
        return Err(ApiError::Forbidden("not the comment author".into()));
    }
    db.delete_comment(&cid).await?;
    let _ = db
        .log_activity(
            &board_id,
            Some(&tid),
            &user.id,
            "comment_deleted",
            Some(&serde_json::json!({"task_id": &tid, "comment_id": &cid}).to_string()),
        )
        .await;
    Ok(Json(serde_json::json!({"deleted": true})))
}
