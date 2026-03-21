use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};

use super::detect;
use super::pty::PtySession;
use super::repo_cache::RepoCache;
use super::token;
use super::worktree;

#[derive(Clone)]
pub struct AgentState {
    pub server_url: String,
    pub server_token: String,
    pub agent_token: String,
    pub repo_cache: Arc<RwLock<RepoCache>>,
    pub sessions: Arc<RwLock<HashMap<String, Arc<SessionHandle>>>>,
}

pub struct SessionHandle {
    pub session_id: String,
    pub board_id: String,
    pub task_id: String,
    pub branch_name: String,
    pub workdir: PathBuf,
    pub pty: PtySession,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    protocol_version: u32,
    sessions_active: usize,
}

#[derive(Deserialize)]
struct RunRequest {
    board_id: String,
    task_id: String,
    prompt: String,
    repo_url: String,
}

#[derive(Serialize)]
struct RunResponse {
    session_id: String,
    status: String,
    branch_name: String,
    ws_url: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    message: String,
    hint: String,
}

#[derive(Deserialize)]
struct SetWorkdirRequest {
    repo_url: String,
    workdir: String,
}

async fn check_agent_token(
    state: &AgentState,
    headers: &axum::http::HeaderMap,
) -> Result<(), StatusCode> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if token != state.agent_token {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

// NOTE: /health is intentionally unauthenticated to support agent detection
// before the user has entered the token.
async fn health(State(state): State<AgentState>) -> Json<HealthResponse> {
    let sessions = state.sessions.read().await;
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_version: 1,
        sessions_active: sessions.len(),
    })
}

async fn run(
    State(state): State<AgentState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RunRequest>,
) -> Result<Json<RunResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_agent_token(&state, &headers)
        .await
        .map_err(|s| {
            (
                s,
                Json(ErrorResponse {
                    error: "unauthorized".to_string(),
                    message: "Invalid agent token".to_string(),
                    hint: "Check the token displayed when starting kanwise agent".to_string(),
                }),
            )
        })?;

    // Resolve repo_url → workdir
    let cache = state.repo_cache.read().await;
    let workdir = cache.get(&body.repo_url).cloned().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "repo_not_found".to_string(),
                message: format!("No local clone found for {}", body.repo_url),
                hint: format!(
                    "Run: kanwise agent config set-workdir {} /path/to/repo",
                    body.repo_url
                ),
            }),
        )
    })?;
    drop(cache);

    let workdir_path = PathBuf::from(&workdir);
    let session_id = uuid::Uuid::new_v4().to_string();
    let branch = worktree::branch_name(&body.task_id, &session_id);

    // Create worktree
    let wt_path = worktree::create_worktree(&workdir_path, &session_id, &branch).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "worktree_failed".to_string(),
                message: format!("Failed to create worktree: {e}"),
                hint: "Check git status in the repo".to_string(),
            }),
        )
    })?;

    // Spawn Claude Code
    let pty = PtySession::spawn(&body.prompt, &wt_path).map_err(|e| {
        let _ = worktree::cleanup_worktree(&workdir_path, &session_id, &branch);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "spawn_failed".to_string(),
                message: format!("Failed to spawn claude: {e}"),
                hint: "Ensure claude is installed and in PATH".to_string(),
            }),
        )
    })?;

    let handle = Arc::new(SessionHandle {
        session_id: session_id.clone(),
        board_id: body.board_id.clone(),
        task_id: body.task_id.clone(),
        branch_name: branch.clone(),
        workdir: workdir_path.clone(),
        pty,
    });

    // Store session
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), Arc::clone(&handle));
    }

    // Create session on Kanwise server (fire-and-forget)
    let server_url = state.server_url.clone();
    let server_token = state.server_token.clone();
    let board_id = body.board_id.clone();
    let task_id = body.task_id.clone();
    let branch_clone = branch.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let _ = client
            .post(format!(
                "{server_url}/api/v1/boards/{board_id}/agent-sessions"
            ))
            .bearer_auth(&server_token)
            .json(&serde_json::json!({
                "task_id": task_id,
                "branch_name": branch_clone,
            }))
            .send()
            .await;
    });

    // Background task: wait for completion, update server, cleanup
    let state_clone = state.clone();
    let sid_clone = session_id.clone();
    tokio::spawn(async move {
        let handle_ref = {
            let sessions = state_clone.sessions.read().await;
            sessions.get(&sid_clone).cloned()
        };
        if let Some(h) = handle_ref {
            // 30-minute timeout
            let timeout_duration = std::time::Duration::from_secs(30 * 60);
            let exit_code = match tokio::time::timeout(timeout_duration, h.pty.wait()).await {
                Ok(result) => result.unwrap_or(1),
                Err(_) => {
                    tracing::warn!("Session {} timed out after 30 minutes", sid_clone);
                    let _ = h.pty.kill();
                    -1 // timeout indicator
                }
            };
            let log = h.pty.get_log();
            let status = if exit_code == 0 { "success" } else { "failed" };

            // Update server
            let client = reqwest::Client::new();
            let _ = client
                .put(format!(
                    "{}/api/v1/boards/{}/agent-sessions/{}",
                    state_clone.server_url, h.board_id, sid_clone
                ))
                .bearer_auth(&state_clone.server_token)
                .json(&serde_json::json!({
                    "status": status,
                    "exit_code": exit_code,
                    "log": log,
                }))
                .send()
                .await;

            // Cleanup worktree
            let _ = worktree::cleanup_worktree(&h.workdir, &sid_clone, &h.branch_name);

            // Remove from active sessions
            let mut sessions = state_clone.sessions.write().await;
            sessions.remove(&sid_clone);
        }
    });

    Ok(Json(RunResponse {
        session_id: session_id.clone(),
        status: "running".to_string(),
        branch_name: branch,
        ws_url: format!("/ws/{session_id}"),
    }))
}

async fn list_sessions(
    State(state): State<AgentState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    check_agent_token(&state, &headers).await?;
    let sessions = state.sessions.read().await;
    let list: Vec<serde_json::Value> = sessions
        .values()
        .map(|h| {
            serde_json::json!({
                "session_id": h.session_id,
                "board_id": h.board_id,
                "task_id": h.task_id,
                "branch_name": h.branch_name,
                "status": "running",
            })
        })
        .collect();
    Ok(Json(list))
}

async fn cancel_session(
    State(state): State<AgentState>,
    headers: axum::http::HeaderMap,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_agent_token(&state, &headers).await?;
    let sessions = state.sessions.read().await;
    if let Some(handle) = sessions.get(&session_id) {
        let _ = handle.pty.kill();
        Ok(Json(serde_json::json!({"status": "cancelled"})))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn set_workdir(
    State(state): State<AgentState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<SetWorkdirRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    check_agent_token(&state, &headers).await?;
    let mut cache = state.repo_cache.write().await;
    cache.set(body.repo_url, body.workdir);
    cache
        .save()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"status": "ok"})))
}

// WebSocket auth uses query parameter since browser WebSocket API
// doesn't support custom headers: ws://localhost:9876/ws/{id}?token={agent_token}
async fn ws_handler(
    State(state): State<AgentState>,
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, StatusCode> {
    let token = params.get("token").ok_or(StatusCode::UNAUTHORIZED)?;
    if token != &state.agent_token {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(ws.on_upgrade(move |socket| handle_ws(state, session_id, socket)))
}

async fn handle_ws(state: AgentState, session_id: String, mut socket: WebSocket) {
    let sessions = state.sessions.read().await;
    let handle = match sessions.get(&session_id) {
        Some(h) => Arc::clone(h),
        None => {
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    drop(sessions);

    let mut rx = handle.pty.output_tx.subscribe();

    // Send any accumulated output first
    let accumulated = {
        let log = handle.pty.output_log.lock().unwrap_or_else(|e| e.into_inner());
        if log.is_empty() { None } else { Some(log.clone()) }
    };
    if let Some(data) = accumulated {
        let _ = socket.send(Message::Binary(data.into())).await;
    }

    // Stream live output
    loop {
        tokio::select! {
            data = rx.recv() => {
                match data {
                    Ok(bytes) => {
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

pub async fn run_agent_server(
    server_url: String,
    server_token: String,
    port: u16,
    allowed_origins: Vec<String>,
) -> anyhow::Result<()> {
    // Load repo cache
    let mut repo_cache = RepoCache::load().unwrap_or_default();

    // Fetch board repo_urls from server and run detection
    let client = reqwest::Client::new();
    if let Ok(resp) = client
        .get(format!("{server_url}/api/v1/boards"))
        .bearer_auth(&server_token)
        .send()
        .await
    {
        if let Ok(boards) = resp.json::<Vec<serde_json::Value>>().await {
            let repo_urls: Vec<String> = boards
                .iter()
                .filter_map(|b| b.get("repo_url").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .collect();
            if !repo_urls.is_empty() {
                let _ = detect::detect_repos(&repo_urls, &mut repo_cache);
            }
        }
    }

    // Generate agent token
    let agent_token = token::generate_agent_token();
    token::save_token(&agent_token)?;

    let state = AgentState {
        server_url,
        server_token,
        agent_token: agent_token.clone(),
        repo_cache: Arc::new(RwLock::new(repo_cache)),
        sessions: Arc::new(RwLock::new(HashMap::new())),
    };

    // CORS
    let origins: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|s| s.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/run", post(run))
        .route("/sessions", get(list_sessions))
        .route("/sessions/{id}/cancel", post(cancel_session))
        .route("/config/set-workdir", post(set_workdir))
        .route("/ws/{session_id}", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Agent server listening on {addr}");
    println!("\n  Agent token: {agent_token}\n");
    println!("  Paste this token in the Kanwise frontend to connect.\n");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
