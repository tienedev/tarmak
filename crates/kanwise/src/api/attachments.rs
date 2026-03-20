use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, State},
    http::{StatusCode, header},
    response::Response,
};
use std::path::PathBuf;

use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use crate::db::Db;
use crate::db::models::{Attachment, Role};

fn uploads_dir() -> PathBuf {
    PathBuf::from(std::env::var("KANBAN_UPLOADS_DIR").unwrap_or_else(|_| "./uploads".into()))
}

fn max_upload_size() -> u64 {
    std::env::var("KANBAN_MAX_UPLOAD_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10 * 1024 * 1024) // 10 MB default
}

pub async fn upload(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    mut multipart: Multipart,
) -> Result<Json<Attachment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let task = db
        .get_task(&tid)
        .await?
        .ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id {
        return Err(ApiError::NotFound("task not found".into()));
    }

    let field = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("multipart error: {e}")))?
        .ok_or_else(|| ApiError::BadRequest("no file field".into()))?;

    let filename = field
        .file_name()
        .unwrap_or("unnamed")
        .replace(['/', '\\', '\0'], "_")
        .replace("..", "_");
    let mime_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| ApiError::BadRequest(format!("read error: {e}")))?;

    if data.len() as u64 > max_upload_size() {
        return Err(ApiError::BadRequest(format!(
            "file too large (max {}MB)",
            max_upload_size() / 1024 / 1024
        )));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let storage_key = format!("{}/{}/{}_{}", board_id, tid, id, filename);
    let full_path = uploads_dir().join(&storage_key);

    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
    }

    tokio::fs::write(&full_path, &data)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("write error: {e}")))?;

    let attachment = db
        .create_attachment(
            &id,
            &tid,
            &board_id,
            &filename,
            &mime_type,
            data.len() as i64,
            &storage_key,
            Some(&user.id),
        )
        .await?;

    let _ = db
        .log_activity(
            &board_id,
            Some(&tid),
            &user.id,
            "attachment_added",
            Some(
                &serde_json::json!({
                    "task_title": &task.title,
                    "filename": &filename,
                    "size_bytes": data.len(),
                })
                .to_string(),
            ),
        )
        .await;

    Ok(Json(attachment))
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<Vec<Attachment>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let attachments = db.list_attachments(&tid).await?;
    Ok(Json(attachments))
}

pub async fn download(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, aid)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let att = db
        .get_attachment(&aid)
        .await?
        .ok_or_else(|| ApiError::NotFound("attachment not found".into()))?;
    if att.board_id != board_id {
        return Err(ApiError::NotFound("attachment not found".into()));
    }

    let path = uploads_dir().join(&att.storage_key);
    let data = tokio::fs::read(&path)
        .await
        .map_err(|_| ApiError::NotFound("file not found on disk".into()))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &att.mime_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!(
                "inline; filename=\"{}\"",
                att.filename
                    .replace('\"', "\\\"")
                    .replace(['\\', '\n', '\r'], "_")
            ),
        )
        .body(Body::from(data))
        .unwrap())
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, aid)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let att = db
        .get_attachment(&aid)
        .await?
        .ok_or_else(|| ApiError::NotFound("attachment not found".into()))?;
    if att.board_id != board_id {
        return Err(ApiError::NotFound("attachment not found".into()));
    }

    let task = db.get_task(&tid).await?;
    db.delete_attachment(&aid).await?;

    let path = uploads_dir().join(&att.storage_key);
    let _ = tokio::fs::remove_file(&path).await;

    if let Some(task) = task {
        let _ = db
            .log_activity(
                &board_id,
                Some(&tid),
                &user.id,
                "attachment_deleted",
                Some(
                    &serde_json::json!({
                        "task_title": &task.title,
                        "filename": &att.filename,
                    })
                    .to_string(),
                ),
            )
            .await;
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
