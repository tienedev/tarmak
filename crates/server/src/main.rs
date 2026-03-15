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
        reset_password(email)
    } else {
        run_http_server().await
    }
}

fn reset_password(email: &str) -> anyhow::Result<()> {
    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string());
    let db = db::Db::new(&db_path)?;

    let user = db
        .get_user_by_email(email)?
        .ok_or_else(|| anyhow::anyhow!("No user found with email: {email}"))?;

    let temp_password = &auth::generate_token()[..16];
    let password_hash = auth::hash_password(temp_password)?;
    db.set_password_hash(&user.id, &password_hash)?;
    db.delete_user_sessions(&user.id)?;

    println!("Password reset for: {} ({})", user.name, email);
    println!("New password: {temp_password}");

    Ok(())
}

async fn run_http_server() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string());

    tracing::info!(db_path = %db_path, "Starting kanwise");

    let db = db::Db::new(&db_path)?;
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

    let app = api::router(db)
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
    let db = db::Db::new(&db_path)?;

    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();

    let server = mcp::KanbanMcpServer::new(db);

    for line in stdin.lock().lines() {
        let line = line?;
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
                                "scope": { "type": "string", "enum": ["info", "tasks", "columns", "all"], "default": "all" },
                                "format": { "type": "string", "enum": ["kbf", "json"], "default": "kbf" }
                            },
                            "required": ["board_id"]
                        }
                    },
                    {
                        "name": "board_mutate",
                        "description": "Create, update, move, or delete board entities (boards, columns, tasks, fields, comments).",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "board_id": { "type": "string", "description": "Board ID" },
                                "action": { "type": "string", "enum": ["create_task","update_task","move_task","delete_task","create_column","update_column","delete_column","create_board","update_board","delete_board","set_field_value","create_field","add_comment"] },
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
                        };
                        server.handle_query(qp).map_err(|e| e.to_string())
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
                        server.handle_mutate(mp).map_err(|e| e.to_string())
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
                        server.handle_sync(sp).map_err(|e| e.to_string())
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
                let mut out = stdout.lock();
                writeln!(out, "{}", serde_json::to_string(&response)?)?;
                out.flush()?;
                continue;
            }
        };

        if let Some(id) = id {
            let response = serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": result,
            });
            let mut out = stdout.lock();
            writeln!(out, "{}", serde_json::to_string(&response)?)?;
            out.flush()?;
        }
    }

    Ok(())
}
