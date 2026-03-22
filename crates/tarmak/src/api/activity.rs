use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;
use crate::db::Db;
use crate::db::models::{ActivityEntry, Role};

#[derive(Deserialize)]
pub struct ListActivityParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub action: Option<String>,
    pub user_id: Option<String>,
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Query(params): Query<ListActivityParams>,
) -> Result<Json<Vec<ActivityEntry>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer).await?;
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0).max(0);
    let entries = db
        .list_activity(
            &board_id,
            params.action.as_deref(),
            params.user_id.as_deref(),
            limit,
            offset,
        )
        .await?;
    Ok(Json(entries))
}
