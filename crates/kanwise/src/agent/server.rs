use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path as StdPath, PathBuf};
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
    /// Cache of validated Kanwise tokens (avoids hitting /auth/me on every request)
    pub validated_tokens: Arc<RwLock<HashSet<String>>>,
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

    // Fast path: known tokens
    if token == state.agent_token || token == state.server_token {
        return Ok(());
    }

    // Check cache of previously validated tokens
    {
        let cache = state.validated_tokens.read().await;
        if cache.contains(token) {
            return Ok(());
        }
    }

    // Validate against Kanwise server
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/v1/auth/me", state.server_url))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if resp.status().is_success() {
        // Cache the validated token
        let mut cache = state.validated_tokens.write().await;
        cache.insert(token.to_string());
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
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
    check_agent_token(&state, &headers).await.map_err(|s| {
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

    // Spawn Claude Code in Terminal.app
    let pty = PtySession::spawn(&body.prompt, &wt_path, &session_id).map_err(|e| {
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
    let sid_for_create = session_id.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let _ = client
            .post(format!(
                "{server_url}/api/v1/boards/{board_id}/agent-sessions"
            ))
            .bearer_auth(&server_token)
            .json(&serde_json::json!({
                "id": sid_for_create,
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

            // Cleanup worktree + temp files
            let _ = worktree::cleanup_worktree(&h.workdir, &sid_clone, &h.branch_name);
            h.pty.cleanup();

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
    let mut sessions = state.sessions.write().await;
    if let Some(handle) = sessions.remove(&session_id) {
        let _ = handle.pty.kill();

        // Notify Kanwise server
        let server_url = state.server_url.clone();
        let server_token = state.server_token.clone();
        let board_id = handle.board_id.clone();
        let sid = session_id.clone();
        let workdir = handle.workdir.clone();
        let branch = handle.branch_name.clone();
        drop(sessions);

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let _ = client
                .put(format!(
                    "{}/api/v1/boards/{}/agent-sessions/{}",
                    server_url, board_id, sid
                ))
                .bearer_auth(&server_token)
                .json(&serde_json::json!({
                    "status": "cancelled",
                    "exit_code": -2,
                }))
                .send()
                .await;
            let _ = worktree::cleanup_worktree(&workdir, &sid, &branch);
        });

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

    // Fast path: known tokens
    let mut authorized = token == &state.agent_token || token == &state.server_token;

    if !authorized {
        // Check cache
        let cache = state.validated_tokens.read().await;
        authorized = cache.contains(token.as_str());
    }

    if !authorized {
        // Validate against Kanwise server
        let client = reqwest::Client::new();
        if let Ok(resp) = client
            .get(format!("{}/api/v1/auth/me", state.server_url))
            .bearer_auth(token)
            .send()
            .await
            && resp.status().is_success()
        {
            let mut cache = state.validated_tokens.write().await;
            cache.insert(token.clone());
            authorized = true;
        }
    }

    if !authorized {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(ws.on_upgrade(move |socket| handle_ws(state, session_id, socket)))
}

async fn handle_ws(state: AgentState, session_id: String, mut socket: WebSocket) {
    let sessions = state.sessions.read().await;
    let exists = sessions.contains_key(&session_id);
    drop(sessions);

    if !exists {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    // Output is displayed in Terminal.app — WebSocket just signals session status
    let msg = format!("Session {session_id} is running in Terminal.app");
    let _ = socket.send(Message::Text(msg.into())).await;

    // Keep connection open until client disconnects
    while let Some(Ok(msg)) = socket.recv().await {
        if matches!(msg, Message::Close(_)) {
            break;
        }
    }
}

// ---- Claude Code local config reader ----

fn read_json_file(path: &StdPath) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn read_file_string(path: &StdPath) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Collect the set of enabled plugin IDs by merging global + project settings.
fn enabled_plugin_ids(
    global_settings: &Option<serde_json::Value>,
    project_settings: &Option<serde_json::Value>,
) -> HashSet<String> {
    let mut enabled = HashSet::new();
    // Global enabledPlugins
    if let Some(obj) = global_settings
        .as_ref()
        .and_then(|v| v.get("enabledPlugins"))
        .and_then(|v| v.as_object())
    {
        for (id, val) in obj {
            if val.as_bool() == Some(true) {
                enabled.insert(id.clone());
            }
        }
    }
    // Project-level overrides
    if let Some(obj) = project_settings
        .as_ref()
        .and_then(|v| v.get("enabledPlugins"))
        .and_then(|v| v.as_object())
    {
        for (id, val) in obj {
            if val.as_bool() == Some(true) {
                enabled.insert(id.clone());
            } else {
                enabled.remove(id);
            }
        }
    }
    enabled
}

fn discover_skills(
    plugins_file: &StdPath,
    enabled_ids: &HashSet<String>,
) -> Vec<serde_json::Value> {
    let content = match std::fs::read_to_string(plugins_file) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let mut skills = Vec::new();
    let mut seen_dirs = HashSet::new();

    if let Some(plugins) = data.get("plugins").and_then(|p| p.as_object()) {
        for (plugin_id, installations) in plugins {
            let enabled = enabled_ids.contains(plugin_id);
            if let Some(installs) = installations.as_array() {
                for install in installs {
                    if let Some(install_path) = install.get("installPath").and_then(|p| p.as_str())
                    {
                        let skills_dir = PathBuf::from(install_path).join("skills");
                        if skills_dir.is_dir()
                            && let Ok(entries) = std::fs::read_dir(&skills_dir)
                        {
                            for entry in entries.flatten() {
                                let dir_name = entry.file_name().to_string_lossy().to_string();
                                let dedup_key = format!("{plugin_id}/{dir_name}");
                                if !seen_dirs.insert(dedup_key) {
                                    continue;
                                }
                                let skill_md = entry.path().join("SKILL.md");
                                if skill_md.exists() {
                                    let content =
                                        std::fs::read_to_string(&skill_md).unwrap_or_default();
                                    let (name, description) = parse_skill_frontmatter(&content);
                                    skills.push(serde_json::json!({
                                        "name": name.unwrap_or_else(|| dir_name.clone()),
                                        "description": description.unwrap_or_default(),
                                        "dir": dir_name,
                                        "plugin": plugin_id,
                                        "enabled": enabled,
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // Sort: enabled first, then alphabetically
    skills.sort_by(|a, b| {
        let ea = a.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let eb = b.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        eb.cmp(&ea).then_with(|| {
            let na = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let nb = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            na.cmp(nb)
        })
    });
    skills
}

fn parse_skill_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    if !content.starts_with("---") {
        return (None, None);
    }
    let rest = &content[3..];
    let end = match rest.find("---") {
        Some(i) => i,
        None => return (None, None),
    };
    let frontmatter = &rest[..end];
    let mut name = None;
    let mut description = None;
    for line in frontmatter.lines() {
        if let Some(val) = line.strip_prefix("name:") {
            name = Some(val.trim().to_string());
        } else if let Some(val) = line.strip_prefix("description:") {
            description = Some(val.trim().to_string());
        }
    }
    (name, description)
}

/// Collect MCP servers matching how Claude Code actually loads them:
/// - ~/.claude/.mcp.json → "global"
/// - ~/.claude.json root mcpServers → "user"
/// - ~/.claude.json projects[workdir].mcpServers → "local"
/// - <project>/.mcp.json → "project"
fn collect_mcp_servers(
    global_mcp: &Option<serde_json::Value>,
    user_config: &Option<serde_json::Value>,
    project_mcp: &Option<serde_json::Value>,
    workdir: &str,
) -> Vec<serde_json::Value> {
    let mut servers = Vec::new();
    let mut seen = HashSet::new();

    // Helper to add servers from a mcpServers object
    let mut add_from = |obj: &serde_json::Map<String, serde_json::Value>, scope: &str| {
        for (name, config) in obj {
            if seen.insert((name.clone(), scope.to_string())) {
                servers.push(serde_json::json!({
                    "name": name,
                    "scope": scope,
                    "command": config.get("command"),
                    "args": config.get("args"),
                }));
            }
        }
    };

    // Global: ~/.claude/.mcp.json
    if let Some(gm) = global_mcp
        && let Some(obj) = gm.get("mcpServers").and_then(|s| s.as_object())
    {
        add_from(obj, "global");
    }

    if let Some(uc) = user_config {
        // User-scope: root-level mcpServers in ~/.claude.json
        if let Some(obj) = uc.get("mcpServers").and_then(|s| s.as_object()) {
            add_from(obj, "user");
        }
        // Local-scope: projects[workdir].mcpServers in ~/.claude.json
        if let Some(proj) = uc.get("projects").and_then(|p| p.get(workdir))
            && let Some(obj) = proj.get("mcpServers").and_then(|s| s.as_object())
        {
            add_from(obj, "local");
        }
    }

    // Project-scope: <project>/.mcp.json
    if let Some(pm) = project_mcp
        && let Some(obj) = pm.get("mcpServers").and_then(|s| s.as_object())
    {
        add_from(obj, "project");
    }

    servers
}

async fn get_config(
    State(state): State<AgentState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    check_agent_token(&state, &headers).await?;

    let home = dirs::home_dir().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    let claude_dir = home.join(".claude");

    // Global config
    let global_settings = read_json_file(&claude_dir.join("settings.json"));
    // ~/.claude/.mcp.json holds global MCP servers
    let global_mcp = read_json_file(&claude_dir.join(".mcp.json"));
    // ~/.claude.json holds user-scope MCPs (root) and local-scope MCPs (per project)
    let user_config = read_json_file(&home.join(".claude.json"));

    // Installed plugins file
    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    let plugins = read_json_file(&plugins_file);

    // Project-level config (from all known workdirs)
    let cache = state.repo_cache.read().await;
    let mut projects: Vec<serde_json::Value> = Vec::new();
    // We'll compute skills per-project since enabledPlugins can differ
    let mut all_skills = Vec::new();
    let mut skills_computed = false;

    for (repo_url, workdir) in &cache.mappings {
        let workdir_path = PathBuf::from(workdir);
        let project_claude_md = read_file_string(&workdir_path.join("CLAUDE.md"));
        let project_mcp = read_json_file(&workdir_path.join(".mcp.json"));
        let project_settings = read_json_file(&workdir_path.join(".claude").join("settings.json"));
        let mcp_servers = collect_mcp_servers(&global_mcp, &user_config, &project_mcp, workdir);

        // Skills: merge global + project enabled plugins, then discover
        if !skills_computed {
            let enabled = enabled_plugin_ids(&global_settings, &project_settings);
            all_skills = discover_skills(&plugins_file, &enabled);
            skills_computed = true;
        }

        projects.push(serde_json::json!({
            "repo_url": repo_url,
            "workdir": workdir,
            "claude_md": project_claude_md,
            "settings": project_settings,
            "mcp_servers": mcp_servers,
        }));
    }

    // If no projects in cache, still compute skills from global settings
    if !skills_computed {
        let enabled = enabled_plugin_ids(&global_settings, &None);
        all_skills = discover_skills(&plugins_file, &enabled);
    }

    // Stats
    let stats = read_json_file(&claude_dir.join("stats-cache.json"));

    // Hooks from global settings
    let hooks = global_settings
        .as_ref()
        .and_then(|v| v.get("hooks"))
        .cloned();

    Ok(Json(serde_json::json!({
        "global": {
            "settings": global_settings,
            "mcp_servers": user_config.as_ref().and_then(|v| v.get("mcpServers")).cloned(),
        },
        "plugins": plugins.as_ref().and_then(|v| v.get("plugins")).cloned(),
        "skills": all_skills,
        "hooks": hooks,
        "projects": projects,
        "stats": stats.map(|s| serde_json::json!({
            "totalSessions": s.get("totalSessions"),
            "totalMessages": s.get("totalMessages"),
            "modelUsage": s.get("modelUsage"),
        })),
    })))
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
        && let Ok(boards) = resp.json::<Vec<serde_json::Value>>().await
    {
        let repo_urls: Vec<String> = boards
            .iter()
            .filter_map(|b| {
                b.get("repo_url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .collect();
        if !repo_urls.is_empty() {
            let _ = detect::detect_repos(&repo_urls, &mut repo_cache);
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
        validated_tokens: Arc::new(RwLock::new(HashSet::new())),
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
        .route("/config", get(get_config))
        .route("/config/set-workdir", post(set_workdir))
        .route("/ws/{session_id}", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Agent server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
