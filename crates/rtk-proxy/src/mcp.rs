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

use cortx_types::{ActionOrgan, Command, ExecutionMode};
use crate::proxy::Proxy;

fn tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "proxy_exec",
            "Execute a command through the secure 7-layer pipeline. Returns structured ExecutionResult.",
            Arc::new(
                serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(
                    serde_json::json!({
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "Shell command to execute" },
                            "cwd": { "type": "string", "description": "Working directory (must be within project root)" },
                            "mode": { "type": "string", "enum": ["assisted", "autonomous", "admin"], "default": "assisted" }
                        },
                        "required": ["command"]
                    }),
                )
                .unwrap(),
            ),
        ),
        Tool::new(
            "proxy_status",
            "Remaining budget, execution count, circuit breaker state.",
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
        Tool::new(
            "proxy_rollback",
            "Restore the last git checkpoint created before a monitored/dangerous command.",
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
pub struct ProxyMcpServer {
    proxy: Arc<Proxy>,
    project_root: std::path::PathBuf,
}

impl ProxyMcpServer {
    pub fn new(proxy: Proxy, project_root: std::path::PathBuf) -> Self {
        Self {
            proxy: Arc::new(proxy),
            project_root,
        }
    }
}

impl ServerHandler for ProxyMcpServer {
    fn get_info(&self) -> ServerInfo {
        InitializeResult {
            protocol_version: Default::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "rtk-proxy".to_string(),
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
        let proxy = self.proxy.clone();
        let project_root = self.project_root.clone();
        async move {
            let args = request.arguments.unwrap_or_default();
            let result: Result<String, String> = match request.name.as_ref() {
                "proxy_exec" => {
                    let cmd_str = match args.get("command").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text(
                            "missing required field: command",
                        )])),
                    };
                    let cwd = args
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(|| project_root.clone());
                    let mode = match args.get("mode").and_then(|v| v.as_str()) {
                        Some("autonomous") => ExecutionMode::Autonomous,
                        Some("admin") => ExecutionMode::Admin,
                        _ => ExecutionMode::Assisted,
                    };
                    let cmd = Command {
                        cmd: cmd_str,
                        cwd,
                        mode,
                        task_id: None,
                    };
                    match proxy.execute(cmd).await {
                        Ok(r) => serde_json::to_string_pretty(&serde_json::json!({
                            "status": format!("{:?}", r.status),
                            "exit_code": r.exit_code,
                            "duration_ms": r.duration_ms,
                            "command": r.command,
                            "tier": r.tier.as_str(),
                            "summary": r.summary,
                            "errors": r.errors.iter().map(|e| serde_json::json!({
                                "file": e.file,
                                "line": e.line,
                                "msg": e.msg,
                            })).collect::<Vec<_>>(),
                            "truncated": r.truncated,
                            "budget_remaining": {
                                "commands": r.budget_remaining.commands_remaining,
                                "cpu_seconds": r.budget_remaining.cpu_seconds_remaining,
                            },
                            "files_touched": r.files_touched,
                        }))
                        .map_err(|e| e.to_string()),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "proxy_status" => {
                    let budget = proxy.remaining_budget();
                    Ok(format!(
                        "Commands remaining: {}, CPU seconds remaining: {}",
                        budget.commands_remaining, budget.cpu_seconds_remaining
                    ))
                }
                "proxy_rollback" => {
                    if crate::git::restore_checkpoint(&project_root).await {
                        Ok("Checkpoint restored successfully.".to_string())
                    } else {
                        Err("No checkpoint found to restore.".to_string())
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
