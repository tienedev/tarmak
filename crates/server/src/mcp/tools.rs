//! MCP tool handlers: board_query, board_mutate, board_sync.
//!
//! These are standalone functions callable from REST endpoints or the rmcp
//! integration (Task 15). The three-tool surface keeps token usage minimal
//! (~600 tokens for definitions vs ~3000 for traditional 15+ tool servers).

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::Db;
use crate::db::models::{FieldType, Priority};

use super::kbf_bridge;

// ---------------------------------------------------------------------------
// Parameter structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardQueryParams {
    /// Board ID, or "list" to list all boards.
    pub board_id: String,
    /// "info" | "tasks" | "columns" | "labels" | "subtasks" | "search" | "attachments" | "all" (default: "all")
    pub scope: Option<String>,
    /// "kbf" | "json" (default: "kbf")
    pub format: Option<String>,
    /// Task ID, required when scope = "subtasks" or "attachments"
    pub task_id: Option<String>,
    /// Search query, required when scope = "search"
    pub query: Option<String>,
    /// Include archived tasks/columns in results (default: false)
    pub include_archived: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardMutateParams {
    pub board_id: String,
    pub action: String,
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardSyncParams {
    pub board_id: String,
    /// Optional KBF delta string to apply before returning state.
    pub delta: Option<String>,
    /// "kbf" | "json" (default: "kbf")
    pub format: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardAskParams {
    pub board_id: String,
    pub question: String,
    /// "text" (default) | "kbf" | "json"
    pub format: Option<String>,
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

/// The kanban MCP server holding a database connection.
pub struct KanbanMcpServer {
    db: Db,
}

impl KanbanMcpServer {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    // -----------------------------------------------------------------------
    // board_query
    // -----------------------------------------------------------------------

    /// Handle a board_query request.
    ///
    /// - `board_id == "list"` -> list all boards
    /// - `format == "json"` -> return JSON
    /// - `format == "kbf"` (default) -> return KBF compact format
    /// - `scope`: "info", "tasks", "columns", "all" (default)
    pub fn handle_query(&self, params: BoardQueryParams) -> Result<String> {
        let format = params.format.as_deref().unwrap_or("kbf");
        let scope = params.scope.as_deref().unwrap_or("all");

        if params.board_id == "list" {
            return self.query_boards_list(format);
        }

        let board_id = &params.board_id;

        match format {
            "kbf" => self.query_kbf(board_id, scope, &params),
            "json" => self.query_json(board_id, scope, &params),
            other => bail!("unsupported format: {other}"),
        }
    }

    fn query_boards_list(&self, format: &str) -> Result<String> {
        match format {
            "kbf" => kbf_bridge::encode_boards_list(&self.db),
            "json" => {
                let boards = self.db.list_boards()?;
                Ok(serde_json::to_string(&boards)?)
            }
            other => bail!("unsupported format: {other}"),
        }
    }

    fn query_kbf(&self, board_id: &str, scope: &str, params: &BoardQueryParams) -> Result<String> {
        match scope {
            "info" => kbf_bridge::encode_board_info(&self.db, board_id),
            "tasks" => kbf_bridge::encode_board_tasks(&self.db, board_id),
            "columns" => kbf_bridge::encode_board_columns(&self.db, board_id),
            "labels" => kbf_bridge::encode_board_labels(&self.db, board_id),
            "subtasks" => {
                let task_id = params.task_id.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("task_id required for subtasks scope"))?;
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                kbf_bridge::encode_task_subtasks(&self.db, task_id)
            }
            "search" => {
                let query = params.query.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("query required for search scope"))?;
                kbf_bridge::encode_search_results(&self.db, board_id, query)
            }
            "attachments" => {
                let task_id = params.task_id.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("task_id required for attachments scope"))?;
                let attachments = self.db.list_attachments(task_id)?;
                Ok(serde_json::to_string(&attachments)?)
            }
            "all" => kbf_bridge::encode_board_all(&self.db, board_id),
            other => bail!("unsupported scope: {other}"),
        }
    }

    fn query_json(&self, board_id: &str, scope: &str, params: &BoardQueryParams) -> Result<String> {
        match scope {
            "info" => {
                let board = self
                    .db
                    .get_board(board_id)?
                    .ok_or_else(|| anyhow::anyhow!("board not found: {board_id}"))?;
                Ok(serde_json::to_string(&board)?)
            }
            "tasks" => {
                let tasks = self.db.list_tasks(board_id, i64::MAX, 0)?;
                Ok(serde_json::to_string(&tasks)?)
            }
            "columns" => {
                let columns = self.db.list_columns(board_id)?;
                Ok(serde_json::to_string(&columns)?)
            }
            "labels" => {
                let labels = self.db.list_labels(board_id)?;
                Ok(serde_json::to_string(&labels)?)
            }
            "subtasks" => {
                let task_id = params.task_id.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("task_id required for subtasks scope"))?;
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let subtasks = self.db.list_subtasks(task_id)?;
                Ok(serde_json::to_string(&subtasks)?)
            }
            "search" => {
                let query = params.query.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("query required for search scope"))?;
                let results = self.db.search_board(board_id, query, 20, false)?;
                Ok(serde_json::to_string(&results)?)
            }
            "attachments" => {
                let task_id = params.task_id.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("task_id required for attachments scope"))?;
                let attachments = self.db.list_attachments(task_id)?;
                Ok(serde_json::to_string(&attachments)?)
            }
            "all" => {
                let board = self
                    .db
                    .get_board(board_id)?
                    .ok_or_else(|| anyhow::anyhow!("board not found: {board_id}"))?;
                let columns = self.db.list_columns(board_id)?;
                let tasks = self.db.list_tasks(board_id, i64::MAX, 0)?;
                let labels = self.db.list_labels(board_id)?;
                let result = serde_json::json!({
                    "board": board,
                    "columns": columns,
                    "tasks": tasks,
                    "labels": labels,
                });
                Ok(serde_json::to_string(&result)?)
            }
            other => bail!("unsupported scope: {other}"),
        }
    }

    // -----------------------------------------------------------------------
    // board_mutate
    // -----------------------------------------------------------------------

    /// Handle a board_mutate request.
    ///
    /// Dispatches based on the `action` field to the appropriate DB method.
    pub fn handle_mutate(&self, params: BoardMutateParams) -> Result<String> {
        let data = &params.data;
        let board_id = &params.board_id;

        match params.action.as_str() {
            "create_task" => {
                let column_id = json_str(data, "column_id")?;
                let title = json_str(data, "title")?;
                let description = data.get("description").and_then(Value::as_str);
                let priority = data
                    .get("priority")
                    .and_then(Value::as_str)
                    .and_then(kbf_bridge::priority_from_short_or_full)
                    .unwrap_or(Priority::Medium);
                let assignee = data.get("assignee").and_then(Value::as_str);

                let task =
                    self.db
                        .create_task(board_id, column_id, title, description, priority, assignee)?;
                Ok(format!("created task {}", task.id))
            }
            "update_task" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let title = data.get("title").and_then(Value::as_str);
                let description = data
                    .get("description")
                    .map(|v| v.as_str());
                let priority = data
                    .get("priority")
                    .and_then(Value::as_str)
                    .and_then(kbf_bridge::priority_from_short_or_full);
                let assignee = data
                    .get("assignee")
                    .map(|v| v.as_str());
                let due_date = data
                    .get("due_date")
                    .map(|v| v.as_str());

                let task = self
                    .db
                    .update_task(task_id, title, description, priority, assignee, due_date)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                Ok(format!("updated task {}", task.id))
            }
            "move_task" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let column_id = json_str(data, "column_id")?;
                let position = data
                    .get("position")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);

                let task = self
                    .db
                    .move_task(task_id, column_id, position)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                Ok(format!("moved task {} to column {}", task.id, task.column_id))
            }
            "delete_task" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let deleted = self.db.delete_task(task_id)?;
                if !deleted {
                    bail!("task not found: {task_id}");
                }
                Ok(format!("deleted task {task_id}"))
            }
            "create_column" => {
                let name = json_str(data, "name")?;
                let wip_limit = data.get("wip_limit").and_then(Value::as_i64);
                let color = data.get("color").and_then(Value::as_str);

                let col = self.db.create_column(board_id, name, wip_limit, color)?;
                Ok(format!("created column {}", col.id))
            }
            "update_column" => {
                let column_id = json_str(data, "column_id")?;
                let name = data.get("name").and_then(Value::as_str);
                let wip_limit = data
                    .get("wip_limit")
                    .map(|v| v.as_i64());
                let color = data
                    .get("color")
                    .map(|v| v.as_str());

                let updated = self.db.update_column(column_id, name, wip_limit, color)?;
                if !updated {
                    bail!("column not found: {column_id}");
                }
                Ok(format!("updated column {column_id}"))
            }
            "delete_column" => {
                let column_id = json_str(data, "column_id")?;
                let deleted = self.db.delete_column(column_id)?;
                if !deleted {
                    bail!("column not found: {column_id}");
                }
                Ok(format!("deleted column {column_id}"))
            }
            "create_board" => {
                let name = json_str(data, "name")?;
                let description = data.get("description").and_then(Value::as_str);

                let board = self.db.create_board(name, description)?;
                Ok(format!("created board {}", board.id))
            }
            "update_board" => {
                let name = data.get("name").and_then(Value::as_str);
                let description = data
                    .get("description")
                    .map(|v| Some(v.as_str().unwrap_or("")));

                let board = self
                    .db
                    .update_board(board_id, name, description)?
                    .ok_or_else(|| anyhow::anyhow!("board not found: {board_id}"))?;
                Ok(format!("updated board {}", board.id))
            }
            "delete_board" => {
                let deleted = self.db.delete_board(board_id)?;
                if !deleted {
                    bail!("board not found: {board_id}");
                }
                Ok(format!("deleted board {board_id}"))
            }
            "set_field_value" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let field_id = json_str(data, "field_id")?;
                let value = json_str(data, "value")?;

                self.db.set_custom_field_value(task_id, field_id, value)?;
                Ok(format!("set field {field_id} on task {task_id}"))
            }
            "create_field" => {
                let name = json_str(data, "name")?;
                let field_type_str = json_str(data, "field_type")?;
                let field_type = FieldType::from_str_db(field_type_str)
                    .ok_or_else(|| anyhow::anyhow!("invalid field_type: {field_type_str}"))?;
                let config = data.get("config").and_then(Value::as_str);

                let field = self.db.create_custom_field(board_id, name, field_type, config)?;
                Ok(format!("created field {}", field.id))
            }
            "add_comment" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let user_id = json_str(data, "user_id")?;
                let content = json_str(data, "content")?;

                let comment = self.db.create_comment(task_id, user_id, content)?;
                Ok(format!("added comment {}", comment.id))
            }
            // ----- Labels -----
            "create_label" => {
                let name = json_str(data, "name")?;
                let color = json_str(data, "color")?;
                let label = self.db.create_label(board_id, name, color)?;
                Ok(format!("created label {}", label.id))
            }
            "update_label" => {
                let label_id = json_str(data, "label_id")?;
                let existing = self.db.get_label(label_id)?
                    .ok_or_else(|| anyhow::anyhow!("label not found: {label_id}"))?;
                if existing.board_id != *board_id {
                    bail!("label {label_id} does not belong to board {board_id}");
                }
                let name = data.get("name").and_then(Value::as_str);
                let color = data.get("color").and_then(Value::as_str);
                self.db.update_label(label_id, name, color)?;
                Ok(format!("updated label {label_id}"))
            }
            "delete_label" => {
                let label_id = json_str(data, "label_id")?;
                let existing = self.db.get_label(label_id)?
                    .ok_or_else(|| anyhow::anyhow!("label not found: {label_id}"))?;
                if existing.board_id != *board_id {
                    bail!("label {label_id} does not belong to board {board_id}");
                }
                self.db.delete_label(label_id)?;
                Ok(format!("deleted label {label_id}"))
            }
            "add_label" => {
                let task_id = json_str(data, "task_id")?;
                let label_id = json_str(data, "label_id")?;
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                self.db.add_task_label(task_id, label_id)?;
                Ok(format!("added label {label_id} to task {task_id}"))
            }
            "remove_label" => {
                let task_id = json_str(data, "task_id")?;
                let label_id = json_str(data, "label_id")?;
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                self.db.remove_task_label(task_id, label_id)?;
                Ok(format!("removed label {label_id} from task {task_id}"))
            }
            // ----- Archive -----
            "archive_task" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                self.db.archive_task(task_id)?;
                let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
                let _ = self.db.log_activity(board_id, Some(task_id), user_id, "task_archived", None);
                Ok(format!("archived task {task_id}"))
            }
            "unarchive_task" => {
                let task_id = json_str(data, "task_id")?;
                let existing = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if existing.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                self.db.unarchive_task(task_id)?;
                let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
                let _ = self.db.log_activity(board_id, Some(task_id), user_id, "task_unarchived", None);
                Ok(format!("unarchived task {task_id}"))
            }
            "archive_column" => {
                let column_id = json_str(data, "column_id")?;
                let columns = self.db.list_columns(board_id)?;
                let col = columns.iter().find(|c| c.id == column_id)
                    .ok_or_else(|| anyhow::anyhow!("column {column_id} not found in board {board_id}"))?;
                let col_name = col.name.clone();
                let count = self.db.archive_column(column_id)?;
                let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
                let _ = self.db.log_activity(board_id, None, user_id, "column_archived",
                    Some(&serde_json::json!({"column_name": col_name, "task_count": count}).to_string()));
                Ok(format!("archived column {column_id} ({count} tasks)"))
            }
            "unarchive_column" => {
                let column_id = json_str(data, "column_id")?;
                let (_, archived_cols) = self.db.list_archived(board_id)?;
                let col = archived_cols.iter().find(|c| c.id == column_id)
                    .ok_or_else(|| anyhow::anyhow!("archived column {column_id} not found in board {board_id}"))?;
                let col_name = col.name.clone();
                let count = self.db.unarchive_column(column_id)?;
                let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
                let _ = self.db.log_activity(board_id, None, user_id, "column_unarchived",
                    Some(&serde_json::json!({"column_name": col_name, "task_count": count}).to_string()));
                Ok(format!("unarchived column {column_id} ({count} tasks)"))
            }
            // ----- Attachments -----
            "delete_attachment" => {
                let attachment_id = json_str(data, "attachment_id")?;
                let att = self.db.get_attachment(attachment_id)?
                    .ok_or_else(|| anyhow::anyhow!("attachment not found: {attachment_id}"))?;
                self.db.delete_attachment(attachment_id)?;
                let uploads_dir = std::path::PathBuf::from(
                    std::env::var("KANBAN_UPLOADS_DIR").unwrap_or_else(|_| "./uploads".into()),
                );
                let _ = std::fs::remove_file(uploads_dir.join(&att.storage_key));
                Ok(format!("deleted attachment {attachment_id}"))
            }
            // ----- Subtasks -----
            "create_subtask" => {
                let task_id = json_str(data, "task_id")?;
                let title = json_str(data, "title")?;
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                let subtask = self.db.create_subtask(task_id, title)?;
                Ok(format!("created subtask {}", subtask.id))
            }
            "update_subtask" => {
                let subtask_id = json_str(data, "subtask_id")?;
                let existing = self.db.get_subtask(subtask_id)?
                    .ok_or_else(|| anyhow::anyhow!("subtask not found: {subtask_id}"))?;
                // Verify subtask's parent task belongs to board
                let task = self.db.get_task(&existing.task_id)?
                    .ok_or_else(|| anyhow::anyhow!("parent task not found"))?;
                if task.board_id != *board_id {
                    bail!("subtask {subtask_id} does not belong to board {board_id}");
                }
                let title = data.get("title").and_then(Value::as_str);
                let completed = data.get("completed").and_then(Value::as_bool);
                self.db.update_subtask(subtask_id, title, completed, None)?;
                Ok(format!("updated subtask {subtask_id}"))
            }
            "delete_subtask" => {
                let subtask_id = json_str(data, "subtask_id")?;
                let existing = self.db.get_subtask(subtask_id)?
                    .ok_or_else(|| anyhow::anyhow!("subtask not found: {subtask_id}"))?;
                let task = self.db.get_task(&existing.task_id)?
                    .ok_or_else(|| anyhow::anyhow!("parent task not found"))?;
                if task.board_id != *board_id {
                    bail!("subtask {subtask_id} does not belong to board {board_id}");
                }
                self.db.delete_subtask(subtask_id)?;
                Ok(format!("deleted subtask {subtask_id}"))
            }
            other => bail!("unknown action: {other}"),
        }
    }

    // -----------------------------------------------------------------------
    // board_sync
    // -----------------------------------------------------------------------

    /// Handle a board_sync request.
    ///
    /// If a `delta` is provided, parse and apply KBF deltas to the database,
    /// then return the current board state.
    pub fn handle_sync(&self, params: BoardSyncParams) -> Result<String> {
        let board_id = params.board_id.clone();

        if let Some(delta_str) = &params.delta {
            self.apply_deltas(&board_id, delta_str)?;
        }

        // Return current state using handle_query
        self.handle_query(BoardQueryParams {
            board_id,
            scope: Some("all".to_string()),
            format: params.format,
            task_id: None,
            query: None,
            include_archived: None,
        })
    }

    // -----------------------------------------------------------------------
    // board_ask
    // -----------------------------------------------------------------------

    /// Handle a board_ask request — natural language query dispatch.
    pub fn handle_ask(&self, params: BoardAskParams) -> Result<String> {
        let format = params.format.as_deref().unwrap_or("text");
        let engine = super::board_ask::AskEngine::new(self.db.clone());
        engine.answer(&params.board_id, &params.question, format)
    }

    /// Parse and apply KBF delta operations to the database.
    ///
    /// Delta formats:
    /// - `>id.field=value` -> update a task field
    /// - `>col|title|desc|pri|who|pos+` -> create a task
    /// - `>id-` -> delete a task
    fn apply_deltas(&self, board_id: &str, delta_str: &str) -> Result<()> {
        let deltas =
            kbf::decode_deltas(delta_str).context("failed to parse KBF deltas")?;

        for delta in deltas {
            match delta {
                kbf::Delta::Update { id, field, value } => {
                    self.apply_field_update(board_id, &id, &field, &value)?;
                }
                kbf::Delta::Create { row } => {
                    self.apply_create(board_id, &row)?;
                }
                kbf::Delta::Delete { id } => {
                    let existing = self.db.get_task(&id)?
                        .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;
                    if existing.board_id != board_id {
                        bail!("task {id} does not belong to board {board_id}");
                    }
                    self.db
                        .delete_task(&id)
                        .context("delete task via delta")?;
                }
            }
        }

        Ok(())
    }

    /// Apply a field-level update delta to a task.
    fn apply_field_update(
        &self,
        board_id: &str,
        task_id: &str,
        field: &str,
        value: &str,
    ) -> Result<()> {
        let existing = self.db.get_task(task_id)?
            .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
        if existing.board_id != board_id {
            bail!("task {task_id} does not belong to board {board_id}");
        }
        match field {
            "title" => {
                self.db
                    .update_task(task_id, Some(value), None, None, None, None)?;
            }
            "desc" => {
                self.db
                    .update_task(task_id, None, Some(Some(value)), None, None, None)?;
            }
            "pri" => {
                let priority = kbf_bridge::priority_from_short_or_full(value)
                    .ok_or_else(|| anyhow::anyhow!("invalid priority: {value}"))?;
                self.db
                    .update_task(task_id, None, None, Some(priority), None, None)?;
            }
            "who" => {
                let assignee = if value.is_empty() {
                    Some(None)
                } else {
                    Some(Some(value))
                };
                self.db
                    .update_task(task_id, None, None, None, assignee, None)?;
            }
            "due" => {
                let due = if value.is_empty() { Some(None) } else { Some(Some(value)) };
                self.db.update_task(task_id, None, None, None, None, due)?;
            }
            "col" => {
                // Move task to different column, keep position 0
                self.db.move_task(task_id, value, 0)?;
            }
            "pos" => {
                // Update position: need to get current column
                let task = self
                    .db
                    .get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                let pos: i64 = value
                    .parse()
                    .context("invalid position value")?;
                self.db.move_task(task_id, &task.column_id, pos)?;
            }
            _ => {
                // Unknown field - could be a custom field, but we'd need the field_id.
                // For now, skip unknown fields silently.
            }
        }
        Ok(())
    }

    /// Apply a create delta: row fields are ordered by the task schema
    /// (col, title, desc, pri, who, pos) - note: id is NOT included in create
    /// deltas; the first field is the column_id.
    fn apply_create(&self, board_id: &str, row: &[String]) -> Result<()> {
        // Expected row order: col, title, desc, pri, who, pos
        // (matching task schema minus the id field which is auto-generated)
        let col = row.first().map(String::as_str).unwrap_or("");
        let title = row.get(1).map(String::as_str).unwrap_or("Untitled");
        let desc = row.get(2).map(String::as_str);
        let desc = if desc == Some("") { None } else { desc };
        let pri = row
            .get(3)
            .and_then(|s| kbf_bridge::priority_from_short_or_full(s))
            .unwrap_or(Priority::Medium);
        let who = row.get(4).map(String::as_str);
        let who = if who == Some("") { None } else { who };

        if col.is_empty() {
            bail!("create delta requires a column_id as first field");
        }

        self.db
            .create_task(board_id, col, title, desc, pri, who)?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract a required string field from a JSON Value.
fn json_str<'a>(data: &'a Value, field: &str) -> Result<&'a str> {
    data.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("missing required field: {field}"))
}

// ---------------------------------------------------------------------------
// REST endpoints for testing
// ---------------------------------------------------------------------------

pub mod api {
    use axum::{Json, extract::State};
    use serde_json::Value;

    use crate::api::error::ApiError;
    use crate::api::middleware::AuthUser;
    use crate::api::permissions;
    use crate::db::Db;
    use crate::db::models::Role;
    use super::*;

    pub async fn query(
        State(db): State<Db>,
        AuthUser(user): AuthUser,
        Json(params): Json<BoardQueryParams>,
    ) -> Result<Json<Value>, ApiError> {
        if params.board_id == "list" {
            let boards = db.list_user_boards(&user.id)?;
            let format = params.format.as_deref().unwrap_or("kbf");
            let result = if format == "json" {
                serde_json::to_string(&boards).map_err(|e| anyhow::anyhow!(e))?
            } else {
                // KBF: fall back to JSON for user-filtered list
                serde_json::to_string(&boards).map_err(|e| anyhow::anyhow!(e))?
            };
            return Ok(Json(serde_json::json!({ "result": result })));
        }
        permissions::require_role(&db, &params.board_id, &user.id, Role::Viewer)?;
        let server = KanbanMcpServer::new(db);
        let result = server.handle_query(params)?;
        Ok(Json(serde_json::json!({ "result": result })))
    }

    pub async fn mutate(
        State(db): State<Db>,
        AuthUser(user): AuthUser,
        Json(params): Json<BoardMutateParams>,
    ) -> Result<Json<Value>, ApiError> {
        if params.action == "create_board" {
            // Any authenticated user can create a board — they become owner.
            let name = params.data.get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing required field: name"))?;
            let description = params.data.get("description").and_then(|v| v.as_str());
            let board = db.create_board(name, description)?;
            db.add_board_member(&board.id, &user.id, Role::Owner)?;
            return Ok(Json(serde_json::json!({ "result": format!("created board {}", board.id) })));
        }

        let min_role = if params.action == "delete_board" { Role::Owner } else { Role::Member };
        permissions::require_role(&db, &params.board_id, &user.id, min_role)?;

        let server = KanbanMcpServer::new(db);
        let result = server.handle_mutate(params)?;
        Ok(Json(serde_json::json!({ "result": result })))
    }

    pub async fn sync(
        State(db): State<Db>,
        AuthUser(user): AuthUser,
        Json(params): Json<BoardSyncParams>,
    ) -> Result<Json<Value>, ApiError> {
        permissions::require_role(&db, &params.board_id, &user.id, Role::Member)?;
        let server = KanbanMcpServer::new(db);
        let result = server.handle_sync(params)?;
        Ok(Json(serde_json::json!({ "result": result })))
    }

    pub async fn ask(
        State(db): State<Db>,
        AuthUser(user): AuthUser,
        Json(params): Json<BoardAskParams>,
    ) -> Result<Json<Value>, ApiError> {
        permissions::require_role(&db, &params.board_id, &user.id, Role::Viewer)?;
        let server = KanbanMcpServer::new(db);
        let result = server.handle_ask(params)?;
        Ok(Json(serde_json::json!({ "result": result })))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Priority;

    fn test_db() -> Db {
        Db::in_memory().expect("in-memory db")
    }

    fn seed(db: &Db) -> (String, String) {
        let board = db.create_board("Test Board", Some("A test")).unwrap();
        let col = db
            .create_column(&board.id, "To Do", None, None)
            .unwrap();
        (board.id, col.id)
    }

    // -----------------------------------------------------------------------
    // handle_query tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_query_list_boards_kbf() {
        let db = test_db();
        db.create_board("Board A", None).unwrap();
        db.create_board("Board B", Some("desc")).unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: "list".into(),
                scope: None,
                format: None, // defaults to kbf
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        assert!(result.starts_with("#board@v1:"));
        assert!(result.contains("Board A"));
        assert!(result.contains("Board B"));
    }

    #[test]
    fn test_query_list_boards_json() {
        let db = test_db();
        db.create_board("Board A", None).unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: "list".into(),
                scope: None,
                format: Some("json".into()),
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        // Should be valid JSON array
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["name"], "Board A");
    }

    #[test]
    fn test_query_board_kbf_all() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "A task", None, Priority::High, None)
            .unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: board_id.clone(),
                scope: Some("all".into()),
                format: None,
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        // Should contain all four KBF sections
        assert!(result.contains("#board@v1:"));
        assert!(result.contains("#col@v1:"));
        assert!(result.contains("#task@v2:"));
    }

    #[test]
    fn test_query_board_kbf_tasks_only() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Task 1", None, Priority::Low, None)
            .unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: board_id.clone(),
                scope: Some("tasks".into()),
                format: Some("kbf".into()),
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        assert!(result.starts_with("#task@v2:"));
        assert!(result.contains("Task 1"));
        // Should NOT contain board or column schemas
        assert!(!result.contains("#board@v1:"));
        assert!(!result.contains("#col@v1:"));
    }

    #[test]
    fn test_query_board_json_all() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "JSON task", None, Priority::Medium, None)
            .unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: board_id.clone(),
                scope: Some("all".into()),
                format: Some("json".into()),
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(parsed.get("board").is_some());
        assert!(parsed.get("columns").is_some());
        assert!(parsed.get("tasks").is_some());
        assert_eq!(parsed["board"]["name"], "Test Board");
    }

    #[test]
    fn test_query_board_json_info() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_query(BoardQueryParams {
                board_id: board_id.clone(),
                scope: Some("info".into()),
                format: Some("json".into()),
                task_id: None,
                query: None,
                include_archived: None,
            })
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["name"], "Test Board");
    }

    #[test]
    fn test_query_invalid_format() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db);
        let result = server.handle_query(BoardQueryParams {
            board_id,
            scope: None,
            format: Some("xml".into()),
            task_id: None,
            query: None,
            include_archived: None,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("unsupported format"));
    }

    // -----------------------------------------------------------------------
    // handle_mutate tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_mutate_create_task() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "create_task".into(),
                data: serde_json::json!({
                    "column_id": col_id,
                    "title": "New task",
                    "priority": "h",
                    "assignee": "bob"
                }),
            })
            .unwrap();

        assert!(result.starts_with("created task "));

        // Verify the task was actually created
        let tasks = db.list_tasks(&board_id, i64::MAX, 0).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "New task");
        assert_eq!(tasks[0].priority, Priority::High);
        assert_eq!(tasks[0].assignee.as_deref(), Some("bob"));
    }

    #[test]
    fn test_mutate_create_task_defaults() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let server = KanbanMcpServer::new(db.clone());
        server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "create_task".into(),
                data: serde_json::json!({
                    "column_id": col_id,
                    "title": "Minimal task"
                }),
            })
            .unwrap();

        let tasks = db.list_tasks(&board_id, i64::MAX, 0).unwrap();
        assert_eq!(tasks[0].priority, Priority::Medium); // default
        assert_eq!(tasks[0].assignee, None); // default
    }

    #[test]
    fn test_mutate_update_task() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let task = db
            .create_task(&board_id, &col_id, "Old title", None, Priority::Low, None)
            .unwrap();

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "update_task".into(),
                data: serde_json::json!({
                    "task_id": task.id,
                    "title": "New title",
                    "priority": "urgent"
                }),
            })
            .unwrap();

        assert!(result.starts_with("updated task "));

        let updated = db.get_task(&task.id).unwrap().unwrap();
        assert_eq!(updated.title, "New title");
        assert_eq!(updated.priority, Priority::Urgent);
    }

    #[test]
    fn test_mutate_move_task() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let col2 = db.create_column(&board_id, "Done", None, None).unwrap();
        let task = db
            .create_task(&board_id, &col_id, "Task", None, Priority::Medium, None)
            .unwrap();

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "move_task".into(),
                data: serde_json::json!({
                    "task_id": task.id,
                    "column_id": col2.id,
                    "position": 0
                }),
            })
            .unwrap();

        assert!(result.contains("moved task"));

        let moved = db.get_task(&task.id).unwrap().unwrap();
        assert_eq!(moved.column_id, col2.id);
    }

    #[test]
    fn test_mutate_delete_task() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let task = db
            .create_task(&board_id, &col_id, "Doomed", None, Priority::Low, None)
            .unwrap();

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "delete_task".into(),
                data: serde_json::json!({ "task_id": task.id }),
            })
            .unwrap();

        assert!(result.contains("deleted task"));
        assert!(db.get_task(&task.id).unwrap().is_none());
    }

    #[test]
    fn test_mutate_create_column() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "create_column".into(),
                data: serde_json::json!({
                    "name": "In Progress",
                    "wip_limit": 3,
                    "color": "#0ff"
                }),
            })
            .unwrap();

        assert!(result.starts_with("created column "));
        let cols = db.list_columns(&board_id).unwrap();
        assert_eq!(cols.len(), 2); // seed created one, we added another
        let new_col = cols.iter().find(|c| c.name == "In Progress").unwrap();
        assert_eq!(new_col.wip_limit, Some(3));
    }

    #[test]
    fn test_mutate_delete_column() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let server = KanbanMcpServer::new(db.clone());
        server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "delete_column".into(),
                data: serde_json::json!({ "column_id": col_id }),
            })
            .unwrap();

        let cols = db.list_columns(&board_id).unwrap();
        assert_eq!(cols.len(), 0);
    }

    #[test]
    fn test_mutate_create_board() {
        let db = test_db();

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: String::new(), // not used for create_board
                action: "create_board".into(),
                data: serde_json::json!({
                    "name": "New Board",
                    "description": "A fresh board"
                }),
            })
            .unwrap();

        assert!(result.starts_with("created board "));
        let boards = db.list_boards().unwrap();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].name, "New Board");
    }

    #[test]
    fn test_mutate_update_board() {
        let db = test_db();
        let board = db.create_board("Old Name", None).unwrap();

        let server = KanbanMcpServer::new(db.clone());
        server
            .handle_mutate(BoardMutateParams {
                board_id: board.id.clone(),
                action: "update_board".into(),
                data: serde_json::json!({ "name": "New Name" }),
            })
            .unwrap();

        let updated = db.get_board(&board.id).unwrap().unwrap();
        assert_eq!(updated.name, "New Name");
    }

    #[test]
    fn test_mutate_delete_board() {
        let db = test_db();
        let board = db.create_board("Doomed Board", None).unwrap();

        let server = KanbanMcpServer::new(db.clone());
        server
            .handle_mutate(BoardMutateParams {
                board_id: board.id.clone(),
                action: "delete_board".into(),
                data: serde_json::json!({}),
            })
            .unwrap();

        assert!(db.get_board(&board.id).unwrap().is_none());
    }

    #[test]
    fn test_mutate_set_field_value() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let field = db
            .create_custom_field(&board_id, "points", FieldType::Number, None)
            .unwrap();
        let task = db
            .create_task(&board_id, &col_id, "Task", None, Priority::Medium, None)
            .unwrap();

        let server = KanbanMcpServer::new(db.clone());
        server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "set_field_value".into(),
                data: serde_json::json!({
                    "task_id": task.id,
                    "field_id": field.id,
                    "value": "8"
                }),
            })
            .unwrap();

        let vals = db.get_custom_field_values(&task.id).unwrap();
        assert_eq!(vals[0].value, "8");
    }

    #[test]
    fn test_mutate_create_field() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "create_field".into(),
                data: serde_json::json!({
                    "name": "estimate",
                    "field_type": "number"
                }),
            })
            .unwrap();

        assert!(result.starts_with("created field "));
        let fields = db.list_custom_fields(&board_id).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "estimate");
    }

    #[test]
    fn test_mutate_add_comment() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let user = db
            .create_user("Alice", "alice@test.com", None, false, None)
            .unwrap();
        let task = db
            .create_task(&board_id, &col_id, "Task", None, Priority::Medium, None)
            .unwrap();

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_mutate(BoardMutateParams {
                board_id: board_id.clone(),
                action: "add_comment".into(),
                data: serde_json::json!({
                    "task_id": task.id,
                    "user_id": user.id,
                    "content": "Looks good!"
                }),
            })
            .unwrap();

        assert!(result.starts_with("added comment "));
        let comments = db.list_comments(&task.id).unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].content, "Looks good!");
    }

    #[test]
    fn test_mutate_unknown_action() {
        let db = test_db();
        let server = KanbanMcpServer::new(db);
        let result = server.handle_mutate(BoardMutateParams {
            board_id: "any".into(),
            action: "explode".into(),
            data: serde_json::json!({}),
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("unknown action"));
    }

    #[test]
    fn test_mutate_missing_required_field() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db);
        let result = server.handle_mutate(BoardMutateParams {
            board_id,
            action: "create_task".into(),
            data: serde_json::json!({ "title": "No column" }),
            // missing column_id
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("column_id"));
    }

    // -----------------------------------------------------------------------
    // handle_sync tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_sync_without_delta() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        db.create_task(&board_id, &col_id, "Existing", None, Priority::Medium, None)
            .unwrap();

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_sync(BoardSyncParams {
                board_id: board_id.clone(),
                delta: None,
                format: None,
            })
            .unwrap();

        // Should return current state in KBF
        assert!(result.contains("#board@v1:"));
        assert!(result.contains("Existing"));
    }

    #[test]
    fn test_sync_with_update_delta() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let task = db
            .create_task(&board_id, &col_id, "Old Title", None, Priority::Low, None)
            .unwrap();

        let delta = format!(">{}.title=New Title", task.id);

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_sync(BoardSyncParams {
                board_id: board_id.clone(),
                delta: Some(delta),
                format: None,
            })
            .unwrap();

        // The returned state should reflect the update
        assert!(result.contains("New Title"));

        // Verify in DB
        let updated = db.get_task(&task.id).unwrap().unwrap();
        assert_eq!(updated.title, "New Title");
    }

    #[test]
    fn test_sync_with_delete_delta() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);
        let task = db
            .create_task(&board_id, &col_id, "To Delete", None, Priority::Medium, None)
            .unwrap();

        let delta = format!(">{}-", task.id);

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_sync(BoardSyncParams {
                board_id: board_id.clone(),
                delta: Some(delta),
                format: None,
            })
            .unwrap();

        // Should not contain the deleted task
        assert!(!result.contains("To Delete"));
        assert!(db.get_task(&task.id).unwrap().is_none());
    }

    #[test]
    fn test_sync_with_create_delta() {
        let db = test_db();
        let (board_id, col_id) = seed(&db);

        let delta = format!(">{col_id}|Created via sync|some desc|h|alice|0+");

        let server = KanbanMcpServer::new(db.clone());
        let result = server
            .handle_sync(BoardSyncParams {
                board_id: board_id.clone(),
                delta: Some(delta),
                format: None,
            })
            .unwrap();

        assert!(result.contains("Created via sync"));

        let tasks = db.list_tasks(&board_id, i64::MAX, 0).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Created via sync");
        assert_eq!(tasks[0].priority, Priority::High);
    }

    #[test]
    fn test_sync_json_format() {
        let db = test_db();
        let (board_id, _) = seed(&db);

        let server = KanbanMcpServer::new(db);
        let result = server
            .handle_sync(BoardSyncParams {
                board_id: board_id.clone(),
                delta: None,
                format: Some("json".into()),
            })
            .unwrap();

        // Should be valid JSON
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(parsed.get("board").is_some());
    }
}
