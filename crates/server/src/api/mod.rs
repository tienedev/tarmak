pub mod activity;
pub mod api_keys;
pub mod archive;
pub mod attachments;
pub mod auth;
pub mod boards;
pub mod columns;
pub mod comments;
pub mod custom_fields;
pub mod error;
pub mod labels;
pub mod middleware;
pub mod notifications;
pub mod permissions;
pub mod rate_limit;
pub mod search;
pub mod subtasks;
pub mod tasks;
pub mod validation;

use axum::{
    Json, Router,
    routing::{get, patch, post, put},
};

use crate::db::Db;
use crate::mcp::tools::api as mcp_api;
use crate::mcp::sse as mcp_sse;
use crate::notifications::NotifTx;

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

/// Build the full API router with all resource routes.
pub fn router(db: Db, rate_limiter: rate_limit::RateLimiter, notif_tx: NotifTx) -> Router {
    let board_item = Router::new()
        .route("/", get(boards::get).put(boards::update).delete(boards::delete));

    let columns = Router::new()
        .route("/", get(columns::list).post(columns::create))
        .route("/{cid}", put(columns::update).delete(columns::delete))
        .route("/{cid}/move", post(columns::move_col))
        .route("/{cid}/archive", post(archive::archive_column))
        .route("/{cid}/unarchive", post(archive::unarchive_column));

    let task_fields = Router::new()
        .route("/", get(custom_fields::get_values))
        .route("/{fid}", put(custom_fields::set_value));

    let task_labels = Router::new()
        .route("/", post(labels::attach))
        .route("/{lid}", axum::routing::delete(labels::detach));

    let task_subtasks = Router::new()
        .route("/", get(subtasks::list).post(subtasks::create))
        .route("/{sid}", put(subtasks::update).delete(subtasks::delete));

    let task_item = Router::new()
        .route("/", get(tasks::get).put(tasks::update).delete(tasks::delete))
        .route("/move", patch(tasks::move_task))
        .route("/archive", post(archive::archive_task))
        .route("/unarchive", post(archive::unarchive_task))
        .route("/duplicate", post(tasks::duplicate))
        .nest("/fields", task_fields)
        .route("/comments", get(comments::list).post(comments::create))
        .route("/comments/{cid}", put(comments::update).delete(comments::delete))
        .nest("/labels", task_labels)
        .nest("/subtasks", task_subtasks)
        .route("/attachments", get(attachments::list).post(attachments::upload))
        .route("/attachments/{aid}", axum::routing::delete(attachments::delete));

    let board_tasks = Router::new()
        .route("/", get(tasks::list).post(tasks::create))
        .nest("/{tid}", task_item);

    let board_labels = Router::new()
        .route("/", get(labels::list).post(labels::create))
        .route("/{lid}", put(labels::update).delete(labels::delete));

    let board_fields = Router::new()
        .route("/", get(custom_fields::list).post(custom_fields::create));

    let per_board = Router::new()
        .merge(board_item)
        .route("/members", get(boards::members))
        .route("/activity", get(activity::list))
        .route("/search", get(search::search))
        .route("/archive", get(archive::list_archived))
        .route("/duplicate", post(boards::duplicate))
        .route("/attachments/{aid}/download", get(attachments::download))
        .nest("/columns", columns)
        .nest("/tasks", board_tasks)
        .nest("/labels", board_labels)
        .nest("/fields", board_fields);

    let boards = Router::new()
        .route("/", get(boards::list).post(boards::create))
        .nest("/{id}", per_board);

    let mcp = Router::new()
        .route("/query", post(mcp_api::query))
        .route("/mutate", post(mcp_api::mutate))
        .route("/sync", post(mcp_api::sync))
        .route("/ask", post(mcp_api::ask))
        .nest("/sse", mcp_sse::sse_router(db.clone(), notif_tx));

    // API key management routes
    let api_key_routes = Router::new()
        .route("/", get(api_keys::list).post(api_keys::create))
        .route("/{key_id}", axum::routing::delete(api_keys::delete));

    // Public auth routes — rate-limited (uses the shared rate limiter)
    let auth_public = Router::new()
        .route("/register", post(auth::register))
        .route("/login", post(auth::login))
        .layer(axum::middleware::from_fn(rate_limit::rate_limit_middleware))
        .layer(axum::Extension(rate_limiter));

    let notification_routes = Router::new()
        .route("/", get(notifications::list))
        .route("/unread-count", get(notifications::unread_count))
        .route("/read-all", patch(notifications::mark_all_read))
        .route("/{id}/read", patch(notifications::mark_read))
        .route("/stream", get(notifications::stream))
        .route("/stream-ticket", post(notifications::create_stream_ticket));

    // All protected routes under one middleware layer: boards, mcp, api-keys,
    // and the authenticated auth endpoints (me, invite, accept).
    let protected = Router::new()
        .nest("/boards", boards)
        .nest("/mcp", mcp)
        .nest("/api-keys", api_key_routes)
        .nest("/notifications", notification_routes)
        .route("/auth/me", get(auth::me))
        .route("/auth/accept", post(auth::accept))
        .route("/auth/invite", get(auth::list_invites).post(auth::invite))
        .route("/auth/invite/{invite_id}", axum::routing::delete(auth::revoke_invite))
        .layer(axum::middleware::from_fn_with_state(
            db.clone(),
            middleware::auth_middleware,
        ));

    Router::new()
        .nest("/api/v1", protected)
        .nest("/api/v1/auth", auth_public)
        .route("/api/v1/health", get(health))
        .with_state(db)
}
