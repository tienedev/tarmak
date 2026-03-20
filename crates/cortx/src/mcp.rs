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

use cortx_types::{Command, ExecutionMode, Memory, MemoryOrgan, MemorySource, PlanningOrgan, RecallQuery, TaskFilter};
use crate::orchestrator::Orchestrator;

fn tool_definitions() -> Vec<Tool> {
    macro_rules! tool {
        ($name:expr, $desc:expr, $schema:expr) => {
            Tool::new(
                $name,
                $desc,
                Arc::new(serde_json::from_value::<serde_json::Map<String, serde_json::Value>>($schema).unwrap()),
            )
        };
    }
    vec![
        tool!("proxy_exec", "Execute a command through the secure pipeline with memory integration.", serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Shell command to execute" },
                "cwd": { "type": "string", "description": "Working directory" },
                "mode": { "type": "string", "enum": ["assisted", "autonomous", "admin"], "default": "assisted" },
                "task_id": { "type": "string", "description": "Optional kanwise task ID to link this execution to" }
            },
            "required": ["command"]
        })),
        tool!("proxy_status", "Remaining budget, execution count, circuit breaker state.", serde_json::json!({
            "type": "object", "properties": {}
        })),
        tool!("proxy_rollback", "Restore the last git checkpoint.", serde_json::json!({
            "type": "object", "properties": {}
        })),
        tool!("memory_store", "Store a project fact in memory.", serde_json::json!({
            "type": "object",
            "properties": {
                "fact": { "type": "string" },
                "citation": { "type": "string" },
                "source": { "type": "string", "enum": ["agent", "proxy", "user"], "default": "user" }
            },
            "required": ["fact", "citation"]
        })),
        tool!("memory_recall", "Search memory (FTS5 + confidence ranking).", serde_json::json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" },
                "files": { "type": "array", "items": { "type": "string" } },
                "error_patterns": { "type": "array", "items": { "type": "string" } },
                "min_confidence": { "type": "number" }
            }
        })),
        tool!("memory_status", "Memory stats: execution count, DB size.", serde_json::json!({
            "type": "object", "properties": {}
        })),
        tool!("planning_next_task", "Get the next task from kanwise matching a filter.", serde_json::json!({
            "type": "object",
            "properties": {
                "board_id": { "type": "string" },
                "label": { "type": "string", "default": "ai-ready" }
            }
        })),
        tool!("planning_complete_task", "Mark a kanwise task as complete (move to done column).", serde_json::json!({
            "type": "object",
            "properties": { "task_id": { "type": "string" } },
            "required": ["task_id"]
        })),
        tool!("planning_list_tasks", "List tasks for a kanwise board with labels, locked_by status.", serde_json::json!({
            "type": "object",
            "properties": {
                "board_id": { "type": "string", "description": "Board ID" },
                "status": { "type": "string", "description": "Optional column name filter (e.g. 'todo', 'in-progress', 'done')" }
            },
            "required": ["board_id"]
        })),
        tool!("planning_decompose", "Decompose an objective into ordered tasks on a board.", serde_json::json!({
            "type": "object",
            "properties": {
                "objective": { "type": "string", "description": "Free text objective" },
                "board_id": { "type": "string", "description": "Target board ID" },
                "tasks": {
                    "type": "array",
                    "description": "Array of tasks to create",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "description": { "type": "string" },
                            "acceptance_criteria": { "type": "string", "description": "Optional acceptance criteria appended to description" },
                            "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"], "default": "medium" },
                            "depends_on": { "type": "array", "items": { "type": "integer" }, "default": [] }
                        },
                        "required": ["title", "description"]
                    }
                }
            },
            "required": ["objective", "board_id", "tasks"]
        })),
        tool!("planning_claim_task", "Atomically claim a task for an agent. Claims a specific task if task_id is provided, otherwise claims the next ai-ready task.", serde_json::json!({
            "type": "object",
            "properties": {
                "board_id": { "type": "string", "description": "Board ID" },
                "agent_id": { "type": "string", "description": "Agent identifier" },
                "task_id": { "type": "string", "description": "Optional specific task ID to claim" }
            },
            "required": ["board_id", "agent_id"]
        })),
        tool!("session_report", "Generate and store a session activity report.", serde_json::json!({
            "type": "object",
            "properties": {
                "board_id": { "type": "string", "description": "Optional board ID to link the report to" }
            }
        })),
        tool!("planning_release_task", "Release a claimed task back to the pool.", serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string", "description": "Task ID to release" },
                "reason": { "type": "string", "description": "Why the task is being released" }
            },
            "required": ["task_id", "reason"]
        })),
        tool!("planning_validate_gates", "Run quality gates (clippy, test, build) and return results.", serde_json::json!({
            "type": "object",
            "properties": {
                "gates": {
                    "type": "array",
                    "items": { "type": "string", "enum": ["clippy", "test", "build"] },
                    "description": "Subset of gates to run. If omitted, loads all gates from cortx-gates.toml."
                },
                "project_root": { "type": "string", "description": "Project root directory. Defaults to current project root." }
            }
        })),
        tool!("planning_escalate", "Escalate a task: add needs-human label, release lock, post agent comment.", serde_json::json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string", "description": "Task ID to escalate" },
                "board_id": { "type": "string", "description": "Board ID the task belongs to" },
                "attempts": { "type": "array", "items": { "type": "string" }, "description": "List of attempted approaches" },
                "errors": { "type": "array", "items": { "type": "string" }, "description": "List of errors encountered" },
                "suggestion": { "type": "string", "description": "Suggested next step for human" }
            },
            "required": ["task_id", "board_id", "attempts", "errors", "suggestion"]
        })),
    ]
}

#[derive(Clone)]
pub struct CortxMcpServer {
    orchestrator: Arc<Orchestrator>,
    project_root: std::path::PathBuf,
}

impl CortxMcpServer {
    pub fn new(orchestrator: Orchestrator, project_root: std::path::PathBuf) -> Self {
        Self {
            orchestrator: Arc::new(orchestrator),
            project_root,
        }
    }
}

impl ServerHandler for CortxMcpServer {
    fn get_info(&self) -> ServerInfo {
        InitializeResult {
            protocol_version: Default::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "cortx".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: Some("Cortx orchestrator — unified proxy + memory + planning. Use proxy_exec for safe command execution, memory_recall for context, planning_* for task management.".to_string()),
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
        let orch = self.orchestrator.clone();
        let project_root = self.project_root.clone();
        async move {
            let args = request.arguments.unwrap_or_default();
            let result: Result<String, String> = match request.name.as_ref() {
                "proxy_exec" => {
                    let cmd_str = match args.get("command").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: command")])),
                    };
                    let cwd = args.get("cwd").and_then(|v| v.as_str())
                        .map(std::path::PathBuf::from).unwrap_or_else(|| project_root.clone());
                    let mode = match args.get("mode").and_then(|v| v.as_str()) {
                        Some("autonomous") => ExecutionMode::Autonomous,
                        Some("admin") => ExecutionMode::Admin,
                        _ => ExecutionMode::Assisted,
                    };
                    let task_id = args.get("task_id").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let cmd = Command { cmd: cmd_str, cwd, mode, task_id };
                    match orch.execute_and_remember(cmd).await {
                        Ok(r) => serde_json::to_string_pretty(&serde_json::json!({
                            "status": format!("{:?}", r.status),
                            "exit_code": r.exit_code,
                            "duration_ms": r.duration_ms,
                            "tier": r.tier.as_str(),
                            "summary": r.summary,
                            "errors": r.errors.iter().map(|e| serde_json::json!({"file": e.file, "line": e.line, "msg": e.msg})).collect::<Vec<_>>(),
                            "files_touched": r.files_touched,
                            "hints": r.hints.iter().map(|h| serde_json::json!({"kind": h.kind, "summary": h.summary, "confidence": h.confidence})).collect::<Vec<_>>(),
                            "budget_remaining": {"commands": r.budget_remaining.commands_remaining, "cpu_seconds": r.budget_remaining.cpu_seconds_remaining},
                        })).map_err(|e| e.to_string()),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "proxy_status" => {
                    let b = orch.remaining_budget();
                    Ok(format!("Session: {}\nCommands remaining: {}\nCPU seconds remaining: {}",
                        orch.session_id(), b.commands_remaining, b.cpu_seconds_remaining))
                }
                "proxy_rollback" => {
                    if rtk_proxy::git::restore_checkpoint(&project_root).await {
                        Ok("Checkpoint restored.".into())
                    } else {
                        Err("No checkpoint found.".into())
                    }
                }
                "memory_store" => {
                    let fact = match args.get("fact").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: fact")])),
                    };
                    let citation = match args.get("citation").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: citation")])),
                    };
                    let source = match args.get("source").and_then(|v| v.as_str()) {
                        Some("agent") => MemorySource::Agent,
                        Some("proxy") => MemorySource::Proxy,
                        _ => MemorySource::User,
                    };
                    match orch.memory().store(Memory::ProjectFact { fact, citation, source }).await {
                        Ok(id) => Ok(format!("Stored: {}", id.0)),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "memory_recall" => {
                    let query = RecallQuery {
                        text: args.get("text").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        files: args.get("files").and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                        error_patterns: args.get("error_patterns").and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                        min_confidence: args.get("min_confidence").and_then(|v| v.as_f64()),
                    };
                    match orch.memory().recall(query).await {
                        Ok(hints) if hints.is_empty() => Ok("No matching memories.".into()),
                        Ok(hints) => Ok(hints.iter()
                            .map(|h| format!("[{:.0}%] {}: {}", h.confidence * 100.0, h.kind, h.summary))
                            .collect::<Vec<_>>().join("\n")),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "memory_status" => {
                    let count = orch.memory().execution_count().await.unwrap_or(0);
                    let size = context_db::purge::db_size_bytes(orch.memory().db()).await.unwrap_or(0);
                    let chains: u64 = orch.memory().db().with_conn(|conn| {
                        Ok(conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |r| r.get(0))?)
                    }).await.unwrap_or(0);
                    let facts: u64 = orch.memory().db().with_conn(|conn| {
                        Ok(conn.query_row("SELECT COUNT(*) FROM project_facts", [], |r| r.get(0))?)
                    }).await.unwrap_or(0);
                    Ok(format!("Executions: {count}\nCausal chains: {chains}\nProject facts: {facts}\nDB size: {:.1} KB", size as f64 / 1024.0))
                }
                "planning_next_task" => {
                    let filter = TaskFilter {
                        board_id: args.get("board_id").and_then(|v| v.as_str()).map(String::from),
                        label: args.get("label").and_then(|v| v.as_str()).map(String::from),
                        priority_min: None,
                    };
                    match orch.kanwise().get_next_task(filter).await {
                        Ok(t) => Ok(format!("[{}] {} (priority: {}, labels: {})",
                            t.id, t.title, t.priority, t.labels.join(", "))),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "planning_complete_task" => {
                    let id = match args.get("task_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: task_id")])),
                    };
                    match orch.complete_task(id).await {
                        Ok(()) => Ok(format!("Task {id} marked complete.")),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "planning_list_tasks" => {
                    let board_id = match args.get("board_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: board_id")])),
                    };
                    let status = args.get("status").and_then(|v| v.as_str());
                    match orch.kanwise().db().list_tasks_with_details(board_id, status).await {
                        Ok(tasks) => {
                            let items: Vec<serde_json::Value> = tasks.iter()
                                .map(|(t, labels, locked_by)| serde_json::json!({
                                    "id": t.id,
                                    "title": t.title,
                                    "description": t.description,
                                    "priority": t.priority.as_str(),
                                    "column_id": t.column_id,
                                    "labels": labels,
                                    "locked_by": locked_by,
                                    "due_date": t.due_date,
                                }))
                                .collect();
                            if items.is_empty() {
                                Ok("No tasks.".into())
                            } else {
                                serde_json::to_string_pretty(&items).map_err(|e| e.to_string())
                            }
                        }
                        Err(e) => Err(e.to_string()),
                    }
                }
                "planning_decompose" => {
                    let objective = match args.get("objective").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: objective")])),
                    };
                    let board_id = match args.get("board_id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: board_id")])),
                    };
                    let tasks_json = match args.get("tasks").and_then(|v| v.as_array()) {
                        Some(a) => a.clone(),
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: tasks")])),
                    };
                    let mut tasks = Vec::new();
                    for item in &tasks_json {
                        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let mut desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        // Append acceptance criteria if provided
                        if let Some(criteria) = item.get("acceptance_criteria").and_then(|v| v.as_str())
                            && !criteria.is_empty()
                        {
                            desc.push_str("\n\n## Acceptance Criteria\n");
                            desc.push_str(criteria);
                        }
                        let priority = match item.get("priority").and_then(|v| v.as_str()) {
                            Some("low") => cortx_types::Priority::Low,
                            Some("high") => cortx_types::Priority::High,
                            Some("urgent") => cortx_types::Priority::Urgent,
                            _ => cortx_types::Priority::Medium,
                        };
                        let depends_on: Vec<usize> = item.get("depends_on")
                            .and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|v| v.as_u64().map(|n| n as usize)).collect())
                            .unwrap_or_default();
                        tasks.push(kanwise::DecomposeTask { title, description: desc, priority, depends_on });
                    }
                    match orch.kanwise().decompose(&objective, &board_id, tasks).await {
                        Ok(ids) => Ok(format!("Created {} tasks: {}", ids.len(), ids.join(", "))),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "planning_claim_task" => {
                    let board_id = match args.get("board_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: board_id")])),
                    };
                    let agent_id = match args.get("agent_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: agent_id")])),
                    };
                    // If task_id is provided, claim that specific task; otherwise claim next available
                    if let Some(task_id) = args.get("task_id").and_then(|v| v.as_str()) {
                        match orch.kanwise().claim_specific_task(task_id, agent_id).await {
                            Ok(Some(t)) => Ok(format!("[{}] {} (priority: {}, labels: {})",
                                t.id, t.title, t.priority, t.labels.join(", "))),
                            Ok(None) => Err(format!("Task {task_id} not found or already claimed.")),
                            Err(e) => Err(e.to_string()),
                        }
                    } else {
                        match orch.kanwise().claim_task(board_id, agent_id).await {
                            Ok(Some(t)) => Ok(format!("[{}] {} (priority: {}, labels: {})",
                                t.id, t.title, t.priority, t.labels.join(", "))),
                            Ok(None) => Ok("No available tasks to claim.".into()),
                            Err(e) => Err(e.to_string()),
                        }
                    }
                }
                "planning_release_task" => {
                    let task_id = match args.get("task_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: task_id")])),
                    };
                    let reason = args.get("reason").and_then(|v| v.as_str()).unwrap_or("unspecified");
                    match orch.kanwise().release_task(task_id, reason).await {
                        Ok(()) => Ok(format!("Task {task_id} released.")),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "session_report" => {
                    let board_id = args.get("board_id").and_then(|v| v.as_str());
                    match orch.generate_morning_report(board_id).await {
                        Ok(summary) => Ok(summary),
                        Err(e) => Err(e.to_string()),
                    }
                }
                "planning_validate_gates" => {
                    let root = args.get("project_root").and_then(|v| v.as_str())
                        .map(std::path::PathBuf::from)
                        .unwrap_or_else(|| project_root.clone());

                    // Determine which gates to run
                    let gate_commands: Vec<(String, String)> = if let Some(gates) = args.get("gates").and_then(|v| v.as_array()) {
                        let mut cmds = Vec::new();
                        for g in gates {
                            let name = match g.as_str() {
                                Some(s) => s,
                                None => continue,
                            };
                            let cmd = match name {
                                "clippy" => "cargo clippy --workspace -- -D warnings",
                                "test" => "cargo test --workspace",
                                "build" => "cargo build --workspace",
                                other => return Ok(CallToolResult::error(vec![Content::text(format!("unknown gate: {other}"))])),
                            };
                            cmds.push((name.to_string(), cmd.to_string()));
                        }
                        cmds
                    } else {
                        // Load from cortx-gates.toml
                        let toml_path = root.join("policies/cortx-gates.toml");
                        match std::fs::read_to_string(&toml_path) {
                            Ok(content) => match crate::gates::GateConfig::from_toml(&content) {
                                Ok(config) => {
                                    let mut cmds = vec![
                                        ("test".to_string(), config.gates.tests),
                                        ("clippy".to_string(), config.gates.lint),
                                    ];
                                    for (name, cmd) in &config.gates.optional {
                                        cmds.push((name.clone(), cmd.clone()));
                                    }
                                    cmds
                                }
                                Err(e) => return Ok(CallToolResult::error(vec![Content::text(format!("invalid cortx-gates.toml: {e}"))])),
                            },
                            Err(_) => {
                                // Fallback to default gates
                                vec![
                                    ("clippy".to_string(), "cargo clippy --workspace -- -D warnings".to_string()),
                                    ("test".to_string(), "cargo test --workspace".to_string()),
                                ]
                            }
                        }
                    };

                    let mut results = Vec::new();
                    let mut all_passed = true;
                    for (gate_name, cmd_str) in gate_commands {
                        let cmd = Command {
                            cmd: cmd_str,
                            cwd: root.clone(),
                            mode: ExecutionMode::Assisted,
                            task_id: None,
                        };
                        let (passed, output) = match orch.execute_and_remember(cmd).await {
                            Ok(r) => {
                                let passed = r.exit_code == Some(0);
                                (passed, r.summary)
                            }
                            Err(e) => (false, e.to_string()),
                        };
                        if !passed { all_passed = false; }
                        results.push(serde_json::json!({
                            "gate": gate_name,
                            "passed": passed,
                            "output": output,
                        }));
                    }
                    serde_json::to_string_pretty(&serde_json::json!({
                        "passed": all_passed,
                        "results": results,
                    })).map_err(|e| e.to_string())
                }
                "planning_escalate" => {
                    let task_id = match args.get("task_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: task_id")])),
                    };
                    let board_id = match args.get("board_id").and_then(|v| v.as_str()) {
                        Some(s) => s,
                        None => return Ok(CallToolResult::error(vec![Content::text("missing: board_id")])),
                    };
                    let attempts: Vec<String> = args.get("attempts").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let errors: Vec<String> = args.get("errors").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let suggestion = args.get("suggestion").and_then(|v| v.as_str()).unwrap_or("");
                    match orch.escalate_task(task_id, board_id, &attempts, &errors, suggestion).await {
                        Ok(()) => Ok(format!("Task {task_id} escalated.")),
                        Err(e) => Err(e.to_string()),
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
