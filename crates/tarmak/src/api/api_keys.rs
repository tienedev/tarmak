use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::db::Db;
use crate::db::models::ApiKey;

use super::error::ApiError;
use super::middleware::AuthUser;

#[derive(Deserialize)]
pub struct CreateKeyRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreateKeyResponse {
    pub key: String,
    pub api_key: ApiKey,
}

pub async fn create(
    AuthUser(user): AuthUser,
    State(db): State<Db>,
    Json(body): Json<CreateKeyRequest>,
) -> Result<Json<CreateKeyResponse>, ApiError> {
    let (raw_key, key_hash, key_prefix) = auth::generate_api_key();
    let api_key = db
        .create_api_key(&user.id, &body.name, &key_hash, &key_prefix)
        .await?;
    Ok(Json(CreateKeyResponse {
        key: raw_key,
        api_key,
    }))
}

pub async fn list(
    AuthUser(user): AuthUser,
    State(db): State<Db>,
) -> Result<Json<Vec<ApiKey>>, ApiError> {
    let keys = db.list_api_keys(&user.id).await?;
    Ok(Json(keys))
}

pub async fn delete(
    AuthUser(user): AuthUser,
    State(db): State<Db>,
    Path(key_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    db.delete_api_key(&key_id, &user.id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
