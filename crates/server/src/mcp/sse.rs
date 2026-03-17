//! MCP over SSE endpoint.
//!
//! Implements the MCP protocol over Server-Sent Events using the rmcp crate's
//! `ServerHandler` trait. This allows MCP clients (like Claude Desktop) to
//! connect via HTTP SSE instead of stdio.
//!
//! Architecture:
//! - GET  /api/v1/mcp/sse       -> SSE stream (server-to-client messages)
//! - POST /api/v1/mcp/sse/message?sessionId=xxx -> client-to-server messages
//!
//! Each SSE connection creates a new `McpSseHandler` backed by a `KanbanMcpServer`.
//! The handler implements `rmcp::ServerHandler` and dispatches tool calls to
//! the existing board_query/board_mutate/board_sync handlers.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{
        Response,
        sse::{Event, Sse},
    },
    routing::{get, post},
};
use futures::{Sink, SinkExt, Stream, StreamExt};
use rmcp::{
    RoleServer, ServiceExt,
    model::{
        CallToolRequestParam, CallToolResult, Content, Implementation, InitializeResult,
        ListToolsResult, PaginatedRequestParam, ServerCapabilities, ServerInfo, Tool,
    },
    handler::server::ServerHandler,
    service::RequestContext,
};
use tokio::sync::{RwLock, mpsc};
use tokio_stream::wrappers::ReceiverStream;

use crate::api::middleware::AuthUser;
use crate::api::permissions;
use crate::db::Db;
use crate::db::models::Role;
use super::KanbanMcpServer;

// ---------------------------------------------------------------------------
// Tool definitions (same schema as the stdio MCP server)
// ---------------------------------------------------------------------------

fn tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "board_query",
            "Query kanban board data. Returns compact KBF format (token-efficient) or JSON. Use board_id='list' to list all boards.",
            Arc::new(serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(serde_json::json!({
                "type": "object",
                "properties": {
                    "board_id": { "type": "string", "description": "Board ID to query, or 'list' for all boards" },
                    "scope": { "type": "string", "enum": ["info", "tasks", "columns", "all"], "default": "all" },
                    "format": { "type": "string", "enum": ["kbf", "json"], "default": "kbf" }
                },
                "required": ["board_id"]
            })).unwrap()),
        ),
        Tool::new(
            "board_mutate",
            "Create, update, move, or delete board entities (boards, columns, tasks, fields, comments).",
            Arc::new(serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(serde_json::json!({
                "type": "object",
                "properties": {
                    "board_id": { "type": "string", "description": "Board ID" },
                    "action": { "type": "string", "enum": ["create_task","update_task","move_task","delete_task","create_column","update_column","delete_column","create_board","update_board","delete_board","set_field_value","create_field","add_comment","update_comment","delete_comment"] },
                    "data": { "type": "object", "description": "Action-specific data" }
                },
                "required": ["board_id", "action", "data"]
            })).unwrap()),
        ),
        Tool::new(
            "board_sync",
            "Sync board state. Optionally apply KBF deltas, then return current state.",
            Arc::new(serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(serde_json::json!({
                "type": "object",
                "properties": {
                    "board_id": { "type": "string" },
                    "delta": { "type": "string", "description": "Optional KBF delta string to apply" },
                    "format": { "type": "string", "enum": ["kbf", "json"], "default": "kbf" }
                },
                "required": ["board_id"]
            })).unwrap()),
        ),
    ]
}

// ---------------------------------------------------------------------------
// McpSseHandler -- implements rmcp::ServerHandler
// ---------------------------------------------------------------------------

/// MCP server handler for SSE connections.
/// Each SSE session gets its own handler instance bound to an authenticated user.
#[derive(Clone)]
pub struct McpSseHandler {
    server: Arc<KanbanMcpServer>,
    db: Db,
    user_id: String,
}

impl McpSseHandler {
    fn new(db: Db, user_id: String) -> Self {
        Self {
            server: Arc::new(KanbanMcpServer::new(db.clone())),
            db,
            user_id,
        }
    }
}

impl ServerHandler for McpSseHandler {
    fn get_info(&self) -> ServerInfo {
        InitializeResult {
            protocol_version: Default::default(),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            server_info: Implementation {
                name: "kanwise".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: None,
        }
    }

    fn list_tools(
        &self,
        _request: PaginatedRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, rmcp::Error>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            tools: tool_definitions(),
            next_cursor: None,
        }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, rmcp::Error>> + Send + '_ {
        let server = self.server.clone();
        let db = self.db.clone();
        let user_id = self.user_id.clone();
        async move {
            let args = request.arguments.unwrap_or_default();
            let args_value = serde_json::Value::Object(args);

            let result: Result<String, String> = match request.name.as_ref() {
                "board_query" => {
                    match serde_json::from_value::<super::BoardQueryParams>(args_value) {
                        Err(e) => Err(format!("invalid params: {e}")),
                        Ok(params) => {
                            if params.board_id == "list" {
                                match db.list_user_boards(&user_id).await {
                                    Ok(b) => serde_json::to_string(&b).map_err(|e| e.to_string()),
                                    Err(e) => Err(e.to_string()),
                                }
                            } else {
                                match permissions::require_role(
                                    &db, &params.board_id, &user_id, Role::Viewer,
                                ).await {
                                    Ok(_) => server.handle_query(params).await.map_err(|e| e.to_string()),
                                    Err(e) => Err(e.to_string()),
                                }
                            }
                        }
                    }
                }
                "board_mutate" => {
                    match serde_json::from_value::<super::BoardMutateParams>(args_value) {
                        Err(e) => Err(format!("invalid params: {e}")),
                        Ok(params) => {
                            if params.action == "create_board" {
                                let res: Result<String, String> = async {
                                    let name = params.data.get("name")
                                        .and_then(|v| v.as_str())
                                        .ok_or_else(|| "missing required field: name".to_string())?;
                                    let description = params.data.get("description").and_then(|v| v.as_str());
                                    let board = db.create_board(name, description).await.map_err(|e| e.to_string())?;
                                    db.add_board_member(&board.id, &user_id, Role::Owner)
                                        .await.map_err(|e| e.to_string())?;
                                    Ok(format!("created board {}", board.id))
                                }.await;
                                res
                            } else {
                                let min_role = if params.action == "delete_board" {
                                    Role::Owner
                                } else {
                                    Role::Member
                                };
                                match permissions::require_role(
                                    &db, &params.board_id, &user_id, min_role,
                                ).await {
                                    Ok(_) => server.handle_mutate(params).await.map_err(|e| e.to_string()),
                                    Err(e) => Err(e.to_string()),
                                }
                            }
                        }
                    }
                }
                "board_sync" => {
                    match serde_json::from_value::<super::BoardSyncParams>(args_value) {
                        Err(e) => Err(format!("invalid params: {e}")),
                        Ok(params) => {
                            match permissions::require_role(
                                &db, &params.board_id, &user_id, Role::Member,
                            ).await {
                                Ok(_) => server.handle_sync(params).await.map_err(|e| e.to_string()),
                                Err(e) => Err(e.to_string()),
                            }
                        }
                    }
                }
                other => Err(format!("Unknown tool: {other}")),
            };

            match result {
                Ok(text) => Ok(CallToolResult::success(vec![Content::text(text)])),
                Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// SSE transport layer (adapted from rmcp::transport::sse_server)
// ---------------------------------------------------------------------------

type SessionId = Arc<str>;
type TxStore = Arc<RwLock<HashMap<SessionId, mpsc::Sender<rmcp::model::ClientJsonRpcMessage>>>>;

/// Shared state for the SSE endpoint handlers.
#[derive(Clone)]
struct SseAppState {
    txs: TxStore,
    db: Db,
    post_path: Arc<str>,
}

fn new_session_id() -> SessionId {
    Arc::from(format!("{:032x}", rand::random::<u128>()))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostEventQuery {
    pub session_id: String,
}

/// POST handler: client sends JSON-RPC messages to the server.
async fn post_event_handler(
    State(app): State<SseAppState>,
    Query(PostEventQuery { session_id }): Query<PostEventQuery>,
    Json(message): Json<rmcp::model::ClientJsonRpcMessage>,
) -> Result<StatusCode, StatusCode> {
    tracing::debug!(%session_id, ?message, "mcp sse: client message");
    let tx = {
        let rg = app.txs.read().await;
        rg.get(session_id.as_str())
            .ok_or(StatusCode::NOT_FOUND)?
            .clone()
    };
    if tx.send(message).await.is_err() {
        tracing::error!("mcp sse: send message error");
        return Err(StatusCode::GONE);
    }
    Ok(StatusCode::ACCEPTED)
}

/// GET handler: establishes SSE stream for a new MCP session.
///
/// Flow:
/// 1. Create session with unique ID
/// 2. Send initial "endpoint" event telling client where to POST
/// 3. Create rmcp transport channels
/// 4. Spawn `McpSseHandler` to serve the connection via rmcp
/// 5. Stream server messages back as SSE events
async fn sse_handler(
    State(app): State<SseAppState>,
    AuthUser(user): AuthUser,
) -> Result<Sse<impl Stream<Item = Result<Event, std::io::Error>>>, Response<String>> {
    let session = new_session_id();
    tracing::info!(%session, "mcp sse: new connection");

    // Channel: client messages flow from POST handler -> rmcp transport
    let (from_client_tx, from_client_rx) = mpsc::channel(64);
    // Channel: server messages flow from rmcp transport -> SSE stream
    let (to_client_tx, to_client_rx) = mpsc::channel(64);

    // Register the session so POST handler can route messages
    app.txs
        .write()
        .await
        .insert(session.clone(), from_client_tx);

    // Build the rmcp transport as a (Sink, Stream) pair
    let stream = ReceiverStream::new(from_client_rx);
    let sink = tokio_util::sync::PollSender::new(to_client_tx);

    // Wrap in our transport adapter
    let transport = SseServerTransport {
        stream,
        sink,
        session_id: session.clone(),
        tx_store: app.txs.clone(),
    };

    // Create handler and spawn the rmcp service
    let handler = McpSseHandler::new(app.db.clone(), user.id.clone());
    let txs_cleanup = app.txs.clone();
    let session_cleanup = session.clone();
    tokio::spawn(async move {
        match handler.serve(transport).await {
            Ok(running) => {
                let _ = running.waiting().await;
                tracing::info!("mcp sse: session ended");
            }
            Err(e) => {
                tracing::error!(error = %e, "mcp sse: service error");
            }
        }
        // Clean up session entry on disconnect (regardless of how it ended)
        txs_cleanup.write().await.remove(&session_cleanup);
    });

    // Build the SSE event stream
    let post_path = app.post_path.clone();
    let sse_stream = futures::stream::once(futures::future::ok(
        Event::default()
            .event("endpoint")
            .data(format!("{post_path}?sessionId={session}")),
    ))
    .chain(ReceiverStream::new(to_client_rx).map(|message| {
        match serde_json::to_string(&message) {
            Ok(bytes) => Ok(Event::default().event("message").data(&bytes)),
            Err(e) => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        }
    }));

    Ok(Sse::new(sse_stream))
}

// ---------------------------------------------------------------------------
// SseServerTransport -- adapts channels to rmcp's transport trait
// ---------------------------------------------------------------------------

/// Transport that bridges SSE HTTP handlers with rmcp's service loop.
/// Implements both `Sink` (server -> client) and `Stream` (client -> server).
struct SseServerTransport {
    stream: ReceiverStream<rmcp::model::ClientJsonRpcMessage>,
    sink: tokio_util::sync::PollSender<rmcp::model::ServerJsonRpcMessage>,
    session_id: SessionId,
    tx_store: TxStore,
}

impl Sink<rmcp::model::ServerJsonRpcMessage> for SseServerTransport {
    type Error = std::io::Error;

    fn poll_ready(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.sink
            .poll_ready_unpin(cx)
            .map_err(std::io::Error::other)
    }

    fn start_send(
        mut self: std::pin::Pin<&mut Self>,
        item: rmcp::model::ServerJsonRpcMessage,
    ) -> Result<(), Self::Error> {
        self.sink
            .start_send_unpin(item)
            .map_err(std::io::Error::other)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.sink
            .poll_flush_unpin(cx)
            .map_err(std::io::Error::other)
    }

    fn poll_close(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        let inner_close_result = self
            .sink
            .poll_close_unpin(cx)
            .map_err(std::io::Error::other);
        if inner_close_result.is_ready() {
            let session_id = self.session_id.clone();
            let tx_store = self.tx_store.clone();
            tokio::spawn(async move {
                tx_store.write().await.remove(&session_id);
            });
        }
        inner_close_result
    }
}

impl Stream for SseServerTransport {
    type Item = rmcp::model::ClientJsonRpcMessage;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.stream.poll_next_unpin(cx)
    }
}

// ---------------------------------------------------------------------------
// Public: axum Router for SSE MCP endpoint
// ---------------------------------------------------------------------------

/// Build the SSE MCP router.
///
/// Mount under `/api/v1/mcp/sse`. Uses `SseAppState` as an `Extension` layer
/// so it can be nested into the parent `Router<Db>`.
///
/// Endpoints:
/// - `GET  /`        -> SSE event stream
/// - `POST /message` -> client JSON-RPC messages
pub fn sse_router(db: Db) -> Router<Db> {
    let state = SseAppState {
        txs: Default::default(),
        db,
        post_path: Arc::from("/api/v1/mcp/sse/message"),
    };

    Router::new()
        .route("/", get(sse_handler_ext))
        .route("/message", post(post_event_handler_ext))
        .layer(axum::Extension(state))
}

/// GET handler wrapper that extracts SseAppState from Extension.
async fn sse_handler_ext(
    axum::Extension(app): axum::Extension<SseAppState>,
    user: AuthUser,
) -> Result<Sse<impl Stream<Item = Result<Event, std::io::Error>>>, Response<String>> {
    sse_handler(State(app), user).await
}

/// POST handler wrapper that extracts SseAppState from Extension.
async fn post_event_handler_ext(
    axum::Extension(app): axum::Extension<SseAppState>,
    query: Query<PostEventQuery>,
    json: Json<rmcp::model::ClientJsonRpcMessage>,
) -> Result<StatusCode, StatusCode> {
    post_event_handler(State(app), query, json).await
}
