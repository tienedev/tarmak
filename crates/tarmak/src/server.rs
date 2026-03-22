use crate::api;
use crate::auth;
use crate::background;
use crate::db;
use crate::notifications;
use crate::static_files;
use crate::sync;
use crate::sync::ws::SyncState;

use std::sync::Arc;

use axum::http::{HeaderName, HeaderValue, Method};
use axum::{Router, routing::get};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::EnvFilter;

fn spawn_cleanup_tasks(db: db::Db, rate_limiter: api::rate_limit::RateLimiter) {
    let db_clone = db.clone();
    // Session cleanup — every hour
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match db_clone.cleanup_expired_sessions().await {
                Ok(count) if count > 0 => {
                    tracing::info!("Purged {count} expired sessions");
                }
                Err(e) => {
                    tracing::warn!("Session cleanup failed: {e}");
                }
                _ => {}
            }
        }
    });

    // Rate limiter sweep — every 5 minutes
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let removed = rate_limiter.sweep();
            if removed > 0 {
                tracing::debug!("Rate limiter: removed {removed} stale IPs");
            }
        }
    });
}

pub async fn run_http_server() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let db_path = crate::db_path();

    tracing::info!(db_path = %db_path, "Starting tarmak");

    let db = db::Db::new(&db_path).await?;
    let sync_state = Arc::new(SyncState::new(db.clone()));

    let ws_routes = Router::new()
        .route("/boards/{board_id}", get(sync::ws::ws_handler))
        .with_state(Arc::clone(&sync_state));

    // CORS: allow the Vite dev server (3000) and the backend itself (4000)
    // Override with TARMAK_ALLOWED_ORIGINS for production.
    let allowed_origins = std::env::var("TARMAK_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:4000".to_string());

    let origins: Vec<HeaderValue> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
        ]);

    let rate_max: usize = std::env::var("RATE_LIMIT_MAX")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let rate_window: u64 = std::env::var("RATE_LIMIT_WINDOW")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let rate_limiter = api::rate_limit::RateLimiter::new(rate_max, rate_window);
    spawn_cleanup_tasks(db.clone(), rate_limiter.clone());

    let (notif_sender, _) =
        tokio::sync::broadcast::channel::<(String, db::models::Notification)>(256);
    let notif_tx = notifications::NotifTx(notif_sender);
    let ticket_store = api::notifications::TicketStore::default();

    tokio::spawn(background::deadline_checker(db.clone(), notif_tx.clone()));

    let app = api::router(db, rate_limiter, notif_tx.clone())
        .layer(axum::Extension(notif_tx.clone()))
        .layer(axum::Extension(ticket_store))
        .nest("/ws", ws_routes)
        .fallback(static_files::static_handler)
        .layer(cors)
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: http://localhost:* ws://localhost:*"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        ));

    let port = std::env::var("PORT").unwrap_or_else(|_| "4000".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

pub async fn reset_password(email: &str) -> anyhow::Result<()> {
    let db_path = crate::db_path();
    let db = db::Db::new(&db_path).await?;

    let user = db
        .get_user_by_email(email)
        .await?
        .ok_or_else(|| anyhow::anyhow!("No user found with email: {email}"))?;

    let temp_password = &auth::generate_token()[..16];
    let password_hash = auth::hash_password(temp_password)?;
    db.set_password_hash(&user.id, &password_hash).await?;
    db.delete_user_sessions(&user.id).await?;

    println!("Password reset for: {} ({})", user.name, email);
    println!("New password: {temp_password}");

    Ok(())
}
