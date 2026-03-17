mod api;
mod auth;
mod db;
mod mcp;
mod static_files;
mod sync;

use std::sync::Arc;

use axum::http::{HeaderValue, Method, HeaderName};
use axum::{Router, routing::get};
use tower_http::cors::{CorsLayer, AllowOrigin};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::EnvFilter;

use sync::ws::SyncState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--mcp".to_string()) {
        run_mcp_stdio().await
    } else if let Some(pos) = args.iter().position(|a| a == "--reset-password") {
        let email = args
            .get(pos + 1)
            .ok_or_else(|| anyhow::anyhow!("Usage: kanwise --reset-password <email>"))?;
        reset_password(email).await
    } else {
        run_http_server().await
    }
}

async fn reset_password(email: &str) -> anyhow::Result<()> {
    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string());
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

async fn run_http_server() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string());

    tracing::info!(db_path = %db_path, "Starting kanwise");

    let db = db::Db::new(&db_path).await?;
    let sync_state = Arc::new(SyncState::new(db.clone()));

    let ws_routes = Router::new()
        .route("/boards/{board_id}", get(sync::ws::ws_handler))
        .with_state(Arc::clone(&sync_state));

    // CORS: allow the Vite dev server (3000) and the backend itself (3001)
    // Override with KANBAN_ALLOWED_ORIGINS for production.
    let allowed_origins = std::env::var("KANBAN_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:3001".to_string());

    let origins: Vec<HeaderValue> = allowed_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([HeaderName::from_static("content-type"), HeaderName::from_static("authorization")]);

    let rate_limiter = api::rate_limit::RateLimiter::new(10, 60);
    spawn_cleanup_tasks(db.clone(), rate_limiter.clone());

    let app = api::router(db, rate_limiter)
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
            HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        ));

    let addr = "0.0.0.0:3001";
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn run_mcp_stdio() -> anyhow::Result<()> {
    eprintln!("WARNING: MCP stdio mode has no authentication. Intended for local single-user use only.");

    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string());
    let db = db::Db::new(&db_path).await?;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();

    let server = mcp::KanbanMcpServer::new(db);

    let mut lines = stdin.lines();
    while let Some(line) = lines.next_line().await? {
        if line.is_empty() {
            continue;
        }

        let request: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let method = request["method"].as_str().unwrap_or("");
        let id = request.get("id").cloned();

        let result = match method {
            "initialize" => serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "kanwise",
                    "version": "0.1.0"
                }
            }),
            "notifications/initialized" => {
                continue;
            }
            "tools/list" => serde_json::json!({
                "tools": [
                    {
                        "name": "board_query",
                        "description": "Query kanban board data. Returns compact KBF format (token-efficient) or JSON. Use board_id='list' to list all boards.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "board_id": { "type": "string", "description": "Board ID to query, or 'list' for all boards" },
                                "scope": { "type": "string", "enum": ["info", "tasks", "columns", "labels", "subtasks", "search", "attachments", "all"], "default": "all" },
                                "format": { "type": "string", "enum": ["kbf", "json"], "default": "kbf" },
                                "task_id": { "type": "string", "description": "Task ID, required when scope = subtasks or attachments" },
                                "query": { "type": "string", "description": "Search query, required when scope = search" },
                                "include_archived": { "type": "boolean", "description": "Include archived tasks/columns in results", "default": false }
                            },
                            "required": ["board_id"]
                        }
                    },
                    {
                        "name": "board_mutate",
                        "description": "Create, update, move, delete, or archive board entities (boards, columns, tasks, fields, comments, labels, subtasks, attachments).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "board_id": { "type": "string", "description": "Board ID" },
                                "action": { "type": "string", "enum": ["create_task","update_task","move_task","delete_task","create_column","update_column","delete_column","create_board","update_board","delete_board","set_field_value","create_field","add_comment","create_label","update_label","delete_label","add_label","remove_label","create_subtask","update_subtask","delete_subtask","archive_task","unarchive_task","archive_column","unarchive_column","delete_attachment"] },
                                "data": { "type": "object", "description": "Action-specific data" }
                            },
                            "required": ["board_id", "action", "data"]
                        }
                    },
                    {
                        "name": "board_sync",
                        "description": "Sync board state. Optionally apply KBF deltas, then return current state.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "board_id": { "type": "string" },
                                "delta": { "type": "string", "description": "Optional KBF delta string to apply" },
                                "format": { "type": "string", "enum": ["kbf", "json"], "default": "kbf" }
                            },
                            "required": ["board_id"]
                        }
                    },
                    {
                        "name": "board_ask",
                        "description": "Ask a natural language question about a board. Supports: overdue tasks, due this week/today, unassigned, no labels, stale/blocked, stats/summary, high priority, no due date, archived items. Falls back to full-text search.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "board_id": { "type": "string", "description": "Board ID" },
                                "question": { "type": "string", "description": "Natural language question about the board" },
                                "format": { "type": "string", "enum": ["text", "kbf", "json"], "default": "text" }
                            },
                            "required": ["board_id", "question"]
                        }
                    }
                ]
            }),
            "tools/call" => {
                let params = &request["params"];
                let tool_name = params["name"].as_str().unwrap_or("");
                let args = &params["arguments"];

                let result = match tool_name {
                    "board_query" => {
                        let qp = mcp::BoardQueryParams {
                            board_id: args["board_id"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            scope: args
                                .get("scope")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            format: args
                                .get("format")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            task_id: args
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            query: args
                                .get("query")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            include_archived: args
                                .get("include_archived")
                                .and_then(|v| v.as_bool()),
                        };
                        server.handle_query(qp).await.map_err(|e| e.to_string())
                    }
                    "board_mutate" => {
                        let mp = mcp::BoardMutateParams {
                            board_id: args["board_id"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            action: args["action"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            data: args
                                .get("data")
                                .cloned()
                                .unwrap_or(serde_json::json!({})),
                        };
                        server.handle_mutate(mp).await.map_err(|e| e.to_string())
                    }
                    "board_sync" => {
                        let sp = mcp::BoardSyncParams {
                            board_id: args["board_id"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            delta: args
                                .get("delta")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            format: args
                                .get("format")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        };
                        server.handle_sync(sp).await.map_err(|e| e.to_string())
                    }
                    "board_ask" => {
                        let ap = mcp::BoardAskParams {
                            board_id: args["board_id"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            question: args["question"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            format: args
                                .get("format")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        };
                        server.handle_ask(ap).await.map_err(|e| e.to_string())
                    }
                    _ => Err(format!("Unknown tool: {tool_name}")),
                };

                match result {
                    Ok(text) => serde_json::json!({
                        "content": [{ "type": "text", "text": text }],
                        "isError": false
                    }),
                    Err(e) => serde_json::json!({
                        "content": [{ "type": "text", "text": e }],
                        "isError": true
                    }),
                }
            }
            _ => {
                if id.is_none() {
                    continue;
                }
                let response = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32601,
                        "message": format!("Method not found: {method}")
                    }
                });
                let out = serde_json::to_string(&response)?;
                stdout.write_all(out.as_bytes()).await?;
                stdout.write_all(b"\n").await?;
                stdout.flush().await?;
                continue;
            }
        };

        if let Some(id) = id {
            let response = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result,
            });
            let out = serde_json::to_string(&response)?;
            stdout.write_all(out.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }

    Ok(())
}
