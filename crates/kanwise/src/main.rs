use kanwise::db;
use kanwise::mcp;
use kanwise::notifications;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "kanwise", about = "Self-hosted kanban board")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Start the HTTP server
    Serve,
    /// Run MCP stdio transport
    Mcp,
    /// Create an atomic backup of the database
    Backup {
        /// Output file path (default: kanwise-backup-YYYYMMDD-HHMMSS.db)
        #[arg(short, long)]
        output: Option<String>,
    },
    /// Restore a database from a backup file
    Restore {
        /// Path to the backup file
        file: String,
        /// Skip confirmation prompt
        #[arg(long)]
        force: bool,
    },
    /// Export a board to JSON
    Export {
        /// Board ID to export
        board_id: String,
        /// Output file (default: stdout)
        #[arg(short, long)]
        output: Option<String>,
    },
    /// Import a board from a Kanwise JSON export
    Import {
        /// Path to the JSON file
        file: String,
        /// Email of the user who will own the imported board
        #[arg(long)]
        owner: String,
    },
    /// User management
    Users {
        #[command(subcommand)]
        command: UsersCommand,
    },
    /// Reset a user's password
    ResetPassword {
        /// User email
        email: String,
    },
    /// Run the local agent server for Claude Code sessions
    Agent {
        /// Kanwise server URL
        #[arg(long)]
        server: String,
        /// Agent port (default: 9876)
        #[arg(long, default_value = "9876")]
        port: u16,
        /// Auth token for Kanwise server
        #[arg(long, env = "KANWISE_TOKEN")]
        token: String,
        /// Allowed CORS origins (comma-separated)
        #[arg(long, default_value = "http://localhost:3000,http://localhost:3001")]
        allowed_origins: String,
    },
}

#[derive(Subcommand)]
enum UsersCommand {
    /// List all registered users
    List,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    match args.command {
        None | Some(Cli::Serve) => kanwise::server::run_http_server().await,
        Some(Cli::Mcp) => run_mcp_stdio().await,
        Some(Cli::ResetPassword { email }) => kanwise::server::reset_password(&email).await,
        Some(Cli::Backup { output }) => kanwise::cli::backup(output).await,
        Some(Cli::Restore { file, force }) => kanwise::cli::restore(&file, force).await,
        Some(Cli::Export { board_id, output }) => {
            kanwise::cli::export_board(&board_id, output).await
        }
        Some(Cli::Import { file, owner }) => kanwise::cli::import_board(&file, &owner).await,
        Some(Cli::Users { command }) => match command {
            UsersCommand::List => kanwise::cli::list_users().await,
        },
        Some(Cli::Agent {
            server,
            port,
            token,
            allowed_origins,
        }) => {
            let origins: Vec<String> = allowed_origins
                .split(',')
                .map(|s| s.trim().to_string())
                .collect();
            kanwise::agent::server::run_agent_server(server, token, port, origins).await
        }
    }
}

async fn run_mcp_stdio() -> anyhow::Result<()> {
    eprintln!(
        "WARNING: MCP stdio mode has no authentication. Intended for local single-user use only."
    );

    let db_path = kanwise::db_path();
    let db = db::Db::new(&db_path).await?;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();

    let (notif_sender, _) =
        tokio::sync::broadcast::channel::<(String, db::models::Notification)>(256);
    let notif_tx = notifications::NotifTx(notif_sender);
    let server = mcp::KanbanMcpServer::new(db, notif_tx);

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
                            board_id: args["board_id"].as_str().unwrap_or("").to_string(),
                            scope: args.get("scope").and_then(|v| v.as_str()).map(String::from),
                            format: args
                                .get("format")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            task_id: args
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            query: args.get("query").and_then(|v| v.as_str()).map(String::from),
                            include_archived: args
                                .get("include_archived")
                                .and_then(|v| v.as_bool()),
                        };
                        server.handle_query(qp).await.map_err(|e| e.to_string())
                    }
                    "board_mutate" => {
                        let mp = mcp::BoardMutateParams {
                            board_id: args["board_id"].as_str().unwrap_or("").to_string(),
                            action: args["action"].as_str().unwrap_or("").to_string(),
                            data: args.get("data").cloned().unwrap_or(serde_json::json!({})),
                        };
                        server.handle_mutate(mp).await.map_err(|e| e.to_string())
                    }
                    "board_sync" => {
                        let sp = mcp::BoardSyncParams {
                            board_id: args["board_id"].as_str().unwrap_or("").to_string(),
                            delta: args.get("delta").and_then(|v| v.as_str()).map(String::from),
                            format: args
                                .get("format")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                        };
                        server.handle_sync(sp).await.map_err(|e| e.to_string())
                    }
                    "board_ask" => {
                        let ap = mcp::BoardAskParams {
                            board_id: args["board_id"].as_str().unwrap_or("").to_string(),
                            question: args["question"].as_str().unwrap_or("").to_string(),
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
