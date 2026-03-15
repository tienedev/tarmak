use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Role, SearchResult};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
    pub limit: Option<i64>,
}

pub async fn search(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<SearchResult>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let limit = params.limit.unwrap_or(20).min(100);
    let q = params.q.trim();
    if q.is_empty() {
        return Ok(Json(vec![]));
    }
    let results = db.search_board(&board_id, q, limit)?;
    Ok(Json(results))
}
