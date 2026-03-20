use std::sync::Arc;

use rmcp::{
    RoleServer,
    handler::server::ServerHandler,
    model::{
        CallToolRequestParam, CallToolResult, Content, Implementation, InitializeResult,
        ListToolsResult, PaginatedRequestParam, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
};

use cortx_types::{Memory, MemoryOrgan, MemorySource, RecallQuery};

use crate::ContextDb;

fn tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "memory_store",
            "Store a project fact in memory.",
            Arc::new(
                serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "fact": { "type": "string", "description": "The fact to store" },
                            "citation": { "type": "string", "description": "Source reference (e.g. 'file:line')" },
                            "source": { "type": "string", "enum": ["agent", "proxy", "user"], "default": "user" }
                        },
                        "required": ["fact", "citation"]
                    }),
                )
                .unwrap(),
            ),
        ),
        Tool::new(
            "memory_recall",
            "Search memory using FTS5 text search and confidence ranking.",
            Arc::new(
                serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "text": { "type": "string", "description": "Full-text search query" },
                            "files": { "type": "array", "items": { "type": "string" }, "description": "Filter by file paths" },
                            "error_patterns": { "type": "array", "items": { "type": "string" }, "description": "Match error patterns in causal chains" },
                            "min_confidence": { "type": "number", "description": "Minimum confidence threshold (0.0-1.0)" }
                        }
                    }),
                )
                .unwrap(),
            ),
        ),
        Tool::new(
            "memory_status",
            "Memory stats: execution count, causal chain count, project fact count, DB size.",
            Arc::new(
                serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(
                    serde_json::json!({
                        "type": "object",
                        "properties": {}
                    }),
                )
                .unwrap(),
            ),
        ),
    ]
}

#[derive(Clone)]
pub struct MemoryMcpServer {
    ctx: Arc<ContextDb>,
}

impl MemoryMcpServer {
    pub fn new(ctx: ContextDb) -> Self {
        Self { ctx: Arc::new(ctx) }
    }
}

impl ServerHandler for MemoryMcpServer {
    fn get_info(&self) -> ServerInfo {
        InitializeResult {
            protocol_version: Default::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "context-db".to_string(),
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
        let ctx = self.ctx.clone();
        async move {
            let args = request.arguments.unwrap_or_default();
            let result: Result<String, String> = match request.name.as_ref() {
                "memory_store" => {
                    let fact = match args.get("fact").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => {
                            return Ok(CallToolResult::error(vec![Content::text(
                                "missing required field: fact",
                            )]));
                        }
                    };
                    let citation = match args.get("citation").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => {
                            return Ok(CallToolResult::error(vec![Content::text(
                                "missing required field: citation",
                            )]));
                        }
                    };
                    let source = match args.get("source").and_then(|v| v.as_str()) {
                        Some("agent") => MemorySource::Agent,
                        Some("proxy") => MemorySource::Proxy,
                        _ => MemorySource::User,
                    };
                    match ctx
                        .store(Memory::ProjectFact {
                            fact,
                            citation,
                            source,
                        })
                        .await
                    {
                        Ok(id) => Ok(format!("Stored with id: {}", id.0)),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "memory_recall" => {
                    let query = RecallQuery {
                        text: args
                            .get("text")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        files: args
                            .get("files")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        error_patterns: args
                            .get("error_patterns")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        min_confidence: args.get("min_confidence").and_then(|v| v.as_f64()),
                    };
                    match ctx.recall(query).await {
                        Ok(hints) => {
                            let formatted: Vec<String> = hints
                                .iter()
                                .map(|h| {
                                    format!(
                                        "[{:.0}%] {}: {}",
                                        h.confidence * 100.0,
                                        h.kind,
                                        h.summary
                                    )
                                })
                                .collect();
                            if formatted.is_empty() {
                                Ok("No matching memories found.".to_string())
                            } else {
                                Ok(formatted.join("\n"))
                            }
                        }
                        Err(e) => Err(e.to_string()),
                    }
                }
                "memory_status" => {
                    let exec_count = ctx.execution_count().await.unwrap_or(0);
                    let db_size = crate::purge::db_size_bytes(ctx.db()).await.unwrap_or(0);
                    let chain_count: u64 = ctx
                        .db()
                        .with_conn(|conn| {
                            Ok(
                                conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |r| {
                                    r.get(0)
                                })?,
                            )
                        })
                        .await
                        .unwrap_or(0);
                    let fact_count: u64 = ctx
                        .db()
                        .with_conn(|conn| {
                            Ok(
                                conn.query_row("SELECT COUNT(*) FROM project_facts", [], |r| {
                                    r.get(0)
                                })?,
                            )
                        })
                        .await
                        .unwrap_or(0);
                    Ok(format!(
                        "Executions: {exec_count}\nCausal chains: {chain_count}\nProject facts: {fact_count}\nDB size: {:.1} KB",
                        db_size as f64 / 1024.0
                    ))
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
