use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Unified API error that converts any `anyhow::Error` into an HTTP response.
pub struct ApiError(pub anyhow::Error);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let msg = self.0.to_string();

        let status = if msg.contains("not found") || msg.contains("no rows") {
            StatusCode::NOT_FOUND
        } else if msg.contains("not a member") || msg.contains("insufficient permissions") {
            StatusCode::FORBIDDEN
        } else if msg.contains("already exists") {
            StatusCode::CONFLICT
        } else if msg.contains("invalid")
            || msg.contains("required")
            || msg.contains("must be")
            || msg.contains("too short")
            || msg.contains("too long")
        {
            StatusCode::BAD_REQUEST
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };

        (status, Json(json!({ "error": msg }))).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}
