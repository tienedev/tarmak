use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use dashmap::DashMap;
use serde::Deserialize;
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::BroadcastStream;

use super::error::ApiError;
use super::middleware::AuthUser;
use crate::db::Db;
use crate::db::models::Notification;
use crate::notifications::NotifTx;

// ---------------------------------------------------------------------------
// Stream ticket store (in-memory, short-lived)
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct TicketStore(pub Arc<DashMap<String, (String, Instant)>>);

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListParams {
    pub unread_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct StreamParams {
    pub ticket: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Notification>>, ApiError> {
    let notifs = db
        .list_notifications(
            &user.id,
            params.unread_only.unwrap_or(false),
            params.limit.unwrap_or(50),
            params.offset.unwrap_or(0),
        )
        .await?;
    Ok(Json(notifs))
}

pub async fn unread_count(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let count = db.unread_notification_count(&user.id).await?;
    Ok(Json(serde_json::json!({ "count": count })))
}

pub async fn mark_read(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let updated = db.mark_notification_read(&id, &user.id).await?;
    if !updated {
        return Err(ApiError::NotFound("notification not found".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn mark_all_read(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let count = db.mark_all_notifications_read(&user.id).await?;
    Ok(Json(serde_json::json!({ "updated": count })))
}

// ---------------------------------------------------------------------------
// Stream ticket
// ---------------------------------------------------------------------------

pub async fn create_stream_ticket(
    AuthUser(user): AuthUser,
    Extension(store): Extension<TicketStore>,
) -> Json<serde_json::Value> {
    // Clean expired tickets opportunistically
    // Retain for 90s (wider than 60s validation window) to prevent race
    // where cleanup removes a ticket right as a client tries to use it
    store
        .0
        .retain(|_, (_, created)| created.elapsed() < Duration::from_secs(90));

    let ticket = uuid::Uuid::new_v4().to_string();
    let expiry = Instant::now();
    store.0.insert(ticket.clone(), (user.id.clone(), expiry));
    Json(serde_json::json!({ "ticket": ticket }))
}

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

pub async fn stream(
    Query(params): Query<StreamParams>,
    Extension(store): Extension<TicketStore>,
    Extension(tx): Extension<NotifTx>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    // Validate ticket
    let (_, entry) = store
        .0
        .remove(&params.ticket)
        .ok_or_else(|| ApiError::Forbidden("invalid or expired ticket".into()))?;
    let (user_id, created) = entry;
    if created.elapsed() > Duration::from_secs(60) {
        return Err(ApiError::Forbidden("ticket expired".into()));
    }

    let rx = tx.0.subscribe();

    // Prepend a "connected" event, then stream notifications
    let connected = futures::stream::once(async {
        Ok::<_, Infallible>(Event::default().event("connected").data("{}"))
    });
    let notifications = BroadcastStream::new(rx).filter_map(move |result| match result {
        Ok((uid, notif)) if uid == user_id => {
            let data = serde_json::to_string(&notif).unwrap_or_default();
            Some(Ok(Event::default().event("notification").data(data)))
        }
        Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
            tracing::warn!("SSE client lagged, skipped {n} notifications");
            None
        }
        _ => None,
    });
    let stream = connected.chain(notifications);

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(30))))
}
