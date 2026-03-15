use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Typed API error with explicit status codes.
pub enum ApiError {
    /// 404 Not Found
    NotFound(String),
    /// 403 Forbidden
    Forbidden(String),
    /// 409 Conflict
    Conflict(String),
    /// 400 Bad Request
    BadRequest(String),
    /// 500 Internal Server Error
    Internal(anyhow::Error),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::NotFound(msg) => write!(f, "{msg}"),
            ApiError::Forbidden(msg) => write!(f, "{msg}"),
            ApiError::Conflict(msg) => write!(f, "{msg}"),
            ApiError::BadRequest(msg) => write!(f, "{msg}"),
            ApiError::Internal(err) => write!(f, "{err}"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Internal(err) => {
                tracing::error!("internal error: {err:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err)
    }
}
