use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::api::error::ApiError;
use crate::api::middleware::AuthUser;
use crate::api::permissions;
use crate::db::models::{AgentSession, AgentSessionStatus, Role};
use crate::db::Db;

#[derive(Deserialize)]
pub struct CreateAgentSession {
    pub id: Option<String>,
    pub task_id: String,
    pub branch_name: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateAgentSession {
    pub status: Option<String>,
    pub exit_code: Option<i32>,
    pub log: Option<String>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub task_id: Option<String>,
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateAgentSession>,
) -> Result<Json<AgentSession>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let session = db
        .create_agent_session(body.id.as_deref(), &board_id, &body.task_id, &user.id, body.branch_name.as_deref())
        .await
        .map_err(|e| {
            if e.to_string().contains("UNIQUE constraint failed") {
                ApiError::Conflict("a session is already running for this task".into())
            } else {
                ApiError::Internal(e)
            }
        })?;
    Ok(Json(session))
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<AgentSession>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let sessions = db
        .list_agent_sessions(&board_id, params.task_id.as_deref())
        .await?;
    Ok(Json(sessions))
}

pub async fn get(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, session_id)): Path<(String, String)>,
) -> Result<Json<AgentSession>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let session = db
        .get_agent_session(&session_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("agent session not found".into()))?;
    Ok(Json(session))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, session_id)): Path<(String, String)>,
    Json(body): Json<UpdateAgentSession>,
) -> Result<Json<AgentSession>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let status = body
        .status
        .as_deref()
        .and_then(AgentSessionStatus::from_str_db);
    let session = db
        .update_agent_session(&session_id, status, body.exit_code, body.log.as_deref())
        .await?
        .ok_or_else(|| ApiError::NotFound("agent session not found".into()))?;
    Ok(Json(session))
}

pub async fn cancel(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, session_id)): Path<(String, String)>,
) -> Result<Json<AgentSession>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let session = db
        .cancel_agent_session(&session_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("agent session not found".into()))?;
    Ok(Json(session))
}
