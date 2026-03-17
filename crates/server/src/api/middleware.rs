use axum::{
    extract::{FromRequestParts, Request, State},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::Response,
};

use crate::auth;
use crate::db::Db;
use crate::db::models::User;

/// Wrapper around `User` that the auth middleware inserts into request
/// extensions. Handler functions can extract this to get the current user.
#[derive(Clone, Debug)]
pub struct AuthUser(pub User);

/// Middleware function that validates the `Authorization: Bearer <token>`
/// header and injects an `AuthUser` into request extensions.
///
/// Supports two token types:
/// - API keys (prefixed with `ok_`): validated via key hash lookup
/// - Session tokens: validated via session table
///
/// If an `AuthUser` is already present in extensions (e.g. no-auth mode),
/// the middleware passes through without re-validating.
///
/// Use with `axum::middleware::from_fn_with_state`.
pub async fn auth_middleware(
    State(db): State<Db>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // If AuthUser already injected (no-auth mode), pass through
    if req.extensions().get::<AuthUser>().is_some() {
        return Ok(next.run(req).await);
    }

    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match token {
        Some(t) => {
            let user = if t.starts_with("ok_") {
                // API key
                let key_hash = auth::hash_token(t);
                db.validate_api_key(&key_hash)
                    .await
                    .map_err(|_| StatusCode::UNAUTHORIZED)?
            } else {
                // Session token
                auth::validate_session(&db, t)
                    .await
                    .map_err(|_| StatusCode::UNAUTHORIZED)?
            };
            req.extensions_mut().insert(AuthUser(user));
            Ok(next.run(req).await)
        }
        None => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Allow handlers to extract `AuthUser` directly from request parts.
/// This works when the middleware has already inserted it into extensions.
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
    }
}
