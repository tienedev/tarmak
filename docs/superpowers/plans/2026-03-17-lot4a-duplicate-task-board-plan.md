# Lot 4a — Duplicate Task & Board Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to duplicate individual tasks (with labels, subtasks, field values) and entire boards (with columns, labels, fields, and optionally tasks).

**Architecture:** Two new `Db` methods (`duplicate_task`, `duplicate_board`) each running a single SQLite transaction. Two new REST endpoints nested in existing routers. Two new MCP `board_mutate` actions. Frontend: "Duplicate" button in TaskEditor footer, "Duplicate board" option in BoardPage header with a confirmation dialog.

**Tech Stack:** Rust (Axum, tokio-rusqlite, rusqlite), React (Zustand, shadcn/ui Dialog), MCP tool schema updates.

**Spec:** `docs/superpowers/specs/2026-03-17-lot4a-duplicate-task-board-design.md`

**Key patterns to follow:**
- `Db` methods use `self.with_conn(move |conn| { ... }).await` — closures capture cloned Strings
- `new_id()` → UUID string, `now_iso()` → RFC3339 string for SQL inserts, `Utc::now()` → `DateTime<Utc>` for struct fields
- `Task.priority` is `Priority` enum — read from SQL as `String` then `Priority::from_str_db(&s).unwrap_or(Priority::Medium)`
- `Task.created_at`/`updated_at` are `DateTime<Utc>` — read from SQL with `parse_dt(&row.get::<_, String>(n)?)?`
- `Task.position` and `Column.position` are `i64`, `Subtask.position` is `i32`
- `Task.archived` is `bool` but stored as integer — read with `row.get::<_, i64>(n)? != 0`
- Permission: `permissions::require_role(&db, &board_id, &user.id, Role::Member).await?`
- `board_members` table has only `(board_id, user_id, role)` — no `id` or `created_at` columns. Use `INSERT OR REPLACE`.
- Board name validation: `validation::validate_title(&name)?` (matching existing `boards::create`)
- MCP `user_id`: `data.get("user_id").and_then(Value::as_str).unwrap_or("mcp")`

---

## Chunk 1: Backend — Duplicate Task

### Task 1: Db method `duplicate_task`

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Write the `duplicate_task` method**

Add after the existing `create_task` method (around line 337). The method runs a single transaction. Use `map_task_row` pattern for reading the source task:

```rust
pub async fn duplicate_task(
    &self,
    task_id: &str,
    board_id: &str,
) -> anyhow::Result<TaskWithRelations> {
    let task_id = task_id.to_string();
    let board_id = board_id.to_string();
    self.with_conn(move |conn| {
        let tx = conn.transaction()?;

        // 1. Read source task, verify board and not archived
        let src: Task = tx
            .query_row(
                "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived FROM tasks WHERE id = ?1 AND board_id = ?2",
                params![task_id, board_id],
                map_task_row,
            )
            .context("Task not found")?;

        if src.archived {
            anyhow::bail!("Cannot duplicate an archived task");
        }

        // 2. Shift positions of subsequent tasks in the same column
        tx.execute(
            "UPDATE tasks SET position = position + 1 WHERE column_id = ?1 AND position > ?2 AND archived = 0",
            params![src.column_id, src.position],
        )?;

        // 3. Create new task
        let new_task_id = new_id();
        let now = now_iso();
        let now_dt = Utc::now();
        let new_title = format!("Copy of {}", src.title);
        let new_position = src.position + 1;

        tx.execute(
            "INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8, ?9, 0)",
            params![new_task_id, board_id, src.column_id, new_title, src.description, src.priority.as_str(), new_position, now, now],
        )?;

        // 4. Copy task_labels
        let mut label_stmt = tx.prepare(
            "SELECT label_id FROM task_labels WHERE task_id = ?1"
        )?;
        let label_ids: Vec<String> = label_stmt
            .query_map(params![task_id], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        for lid in &label_ids {
            tx.execute(
                "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                params![new_task_id, lid],
            )?;
        }

        // 5. Copy subtasks
        let mut sub_stmt = tx.prepare(
            "SELECT title, position FROM subtasks WHERE task_id = ?1 ORDER BY position"
        )?;
        let subtasks: Vec<(String, i32)> = sub_stmt
            .query_map(params![task_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (sub_title, sub_pos) in &subtasks {
            tx.execute(
                "INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                params![new_id(), new_task_id, sub_title, sub_pos, now],
            )?;
        }

        // 6. Copy task_custom_field_values (table has only task_id, field_id, value — composite PK)
        let mut fv_stmt = tx.prepare(
            "SELECT field_id, value FROM task_custom_field_values WHERE task_id = ?1"
        )?;
        let field_vals: Vec<(String, String)> = fv_stmt
            .query_map(params![task_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (fid, val) in &field_vals {
            tx.execute(
                "INSERT INTO task_custom_field_values (task_id, field_id, value) VALUES (?1, ?2, ?3)",
                params![new_task_id, fid, val],
            )?;
        }

        // Build labels for response
        let labels: Vec<Label> = label_ids
            .iter()
            .filter_map(|lid| {
                tx.query_row(
                    "SELECT id, board_id, name, color, created_at FROM labels WHERE id = ?1",
                    params![lid],
                    |row| {
                        Ok(Label {
                            id: row.get(0)?,
                            board_id: row.get(1)?,
                            name: row.get(2)?,
                            color: row.get(3)?,
                            created_at: parse_dt(&row.get::<_, String>(4)?)?,
                        })
                    },
                )
                .ok()
            })
            .collect();

        let subtask_count = SubtaskCount {
            total: subtasks.len() as i32,
            completed: 0,
        };

        let task = Task {
            id: new_task_id,
            board_id,
            column_id: src.column_id,
            title: new_title,
            description: src.description,
            priority: src.priority,
            assignee: None,
            due_date: None,
            position: new_position,
            created_at: now_dt,
            updated_at: now_dt,
            archived: false,
        };

        tx.commit()?;

        Ok(TaskWithRelations {
            task,
            labels,
            subtask_count,
            attachment_count: 0,
        })
    })
    .await
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`
Expected: no errors related to `duplicate_task`.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat: add duplicate_task Db method"
```

### Task 2: REST handler for duplicate task

**Files:**
- Modify: `crates/server/src/api/tasks.rs`
- Modify: `crates/server/src/api/mod.rs`

**Context:** Handlers use `State(db)`, `AuthUser(user)`, `Path(...)`. Permission check: `permissions::require_role(&db, &board_id, &user.id, Role::Member).await?`. Activity logging: `let _ = db.log_activity(...)`. `TaskWithRelations` is already imported in tasks.rs (line 10).

- [ ] **Step 1: Add the `duplicate` handler to `tasks.rs`**

Add after the existing `delete` handler:

```rust
pub async fn duplicate(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
) -> Result<Json<TaskWithRelations>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let result = db.duplicate_task(&task_id, &board_id).await?;
    let _ = db.log_activity(
        &board_id,
        Some(&result.task.id),
        &user.id,
        "task_duplicated",
        Some(&serde_json::json!({"source_task_id": task_id, "title": result.task.title}).to_string()),
    ).await;
    Ok(Json(result))
}
```

- [ ] **Step 2: Add the route to `mod.rs`**

In `crates/server/src/api/mod.rs`, add `.route("/duplicate", post(tasks::duplicate))` to the `task_item` router (around line 60, after `/unarchive`).

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`

- [ ] **Step 4: Run tests**

Run: `cargo test -p kanwise-server 2>&1 | tail -20`
Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/api/tasks.rs crates/server/src/api/mod.rs
git commit -m "feat: add POST /tasks/{tid}/duplicate REST endpoint"
```

### Task 3: MCP `duplicate_task` action

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`
- Modify: `crates/server/src/mcp/sse.rs`

**Context:** In `tools.rs`, `handle_mutate()` (line 219) matches `params.action.as_str()`. `KanbanMcpServer` has no `user_id` field — use `data.get("user_id").and_then(Value::as_str).unwrap_or("mcp")` pattern (see `archive_task` at line 520). In `sse.rs`, the `board_mutate` tool schema (line ~74) has an `enum` array listing all valid actions.

- [ ] **Step 1: Add `duplicate_task` match arm in `handle_mutate()`**

```rust
"duplicate_task" => {
    let task_id = json_str(data, "task_id")?;
    let result = self.db.duplicate_task(task_id, board_id).await?;
    let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
    let _ = self.db.log_activity(
        board_id,
        Some(&result.task.id),
        user_id,
        "task_duplicated",
        Some(&serde_json::json!({"source_task_id": task_id, "title": result.task.title}).to_string()),
    ).await;
    Ok(format!("duplicated task {} as {}", task_id, result.task.id))
}
```

- [ ] **Step 2: Add `"duplicate_task"` to the action enum in `sse.rs`**

In the `board_mutate` tool schema JSON, add `"duplicate_task"` to the `enum` array for the `action` property (around line 74).

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/mcp/tools.rs crates/server/src/mcp/sse.rs
git commit -m "feat: add duplicate_task MCP action"
```

---

## Chunk 2: Backend — Duplicate Board

### Task 4: Db method `duplicate_board`

**Files:**
- Modify: `crates/server/src/db/repo.rs`

**Context:** Board struct (models.rs:152-158) has `DateTime<Utc>` fields. The `board_members` table has only `(board_id, user_id, role)` columns — no `id` or `created_at`. Valid roles: `owner`, `member`, `viewer`. Column.position and CustomField.position are `i64`. Use `std::collections::HashMap` for UUID remapping.

- [ ] **Step 1: Write the `duplicate_board` method**

Add after `duplicate_task`:

```rust
pub async fn duplicate_board(
    &self,
    board_id: &str,
    new_name: &str,
    include_tasks: bool,
    owner_id: &str,
) -> anyhow::Result<Board> {
    let board_id = board_id.to_string();
    let new_name = new_name.to_string();
    let owner_id = owner_id.to_string();
    self.with_conn(move |conn| {
        let tx = conn.transaction()?;
        let now = now_iso();
        let now_dt = Utc::now();

        // 1. Verify source board exists
        tx.query_row("SELECT id FROM boards WHERE id = ?1", params![board_id], |_| Ok(()))
            .context("Source board not found")?;

        // 2. Create new board
        let new_board_id = new_id();
        tx.execute(
            "INSERT INTO boards (id, name, description, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4)",
            params![new_board_id, new_name, now, now],
        )?;

        // 3. Add owner (board_members has only board_id, user_id, role)
        tx.execute(
            "INSERT OR REPLACE INTO board_members (board_id, user_id, role) VALUES (?1, ?2, 'owner')",
            params![new_board_id, owner_id],
        )?;

        // 4. Copy columns (skip archived)
        let mut col_map = std::collections::HashMap::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id, name, position, wip_limit, color FROM columns WHERE board_id = ?1 AND archived = 0 ORDER BY position"
            )?;
            let cols: Vec<(String, String, i64, Option<i64>, Option<String>)> = stmt
                .query_map(params![board_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                })?
                .collect::<Result<_, _>>()?;
            for (old_id, name, pos, wip, color) in cols {
                let nid = new_id();
                tx.execute(
                    "INSERT INTO columns (id, board_id, name, position, wip_limit, color, archived) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                    params![nid, new_board_id, name, pos, wip, color],
                )?;
                col_map.insert(old_id, nid);
            }
        }

        // 5. Copy labels
        let mut label_map = std::collections::HashMap::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id, name, color FROM labels WHERE board_id = ?1"
            )?;
            let labels: Vec<(String, String, String)> = stmt
                .query_map(params![board_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<Result<_, _>>()?;
            for (old_id, name, color) in labels {
                let nid = new_id();
                tx.execute(
                    "INSERT INTO labels (id, board_id, name, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![nid, new_board_id, name, color, now],
                )?;
                label_map.insert(old_id, nid);
            }
        }

        // 6. Copy custom_fields
        let mut field_map = std::collections::HashMap::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id, name, field_type, config, position FROM custom_fields WHERE board_id = ?1"
            )?;
            let fields: Vec<(String, String, String, Option<String>, i64)> = stmt
                .query_map(params![board_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                })?
                .collect::<Result<_, _>>()?;
            for (old_id, name, ftype, config, pos) in fields {
                let nid = new_id();
                tx.execute(
                    "INSERT INTO custom_fields (id, board_id, name, field_type, config, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![nid, new_board_id, name, ftype, config, pos],
                )?;
                field_map.insert(old_id, nid);
            }
        }

        // 7. Copy tasks if requested
        if include_tasks {
            let mut task_map = std::collections::HashMap::new();
            {
                let mut stmt = tx.prepare(
                    "SELECT id, column_id, title, description, priority, position FROM tasks WHERE board_id = ?1 AND archived = 0"
                )?;
                let tasks: Vec<(String, String, String, Option<String>, String, i64)> = stmt
                    .query_map(params![board_id], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
                    })?
                    .collect::<Result<_, _>>()?;
                for (old_id, old_col_id, title, desc, prio, pos) in tasks {
                    let new_col_id = match col_map.get(&old_col_id) {
                        Some(id) => id.clone(),
                        None => continue, // column was archived, skip
                    };
                    let nid = new_id();
                    tx.execute(
                        "INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7, ?8, ?9, 0)",
                        params![nid, new_board_id, new_col_id, title, desc, prio, pos, now, now],
                    )?;
                    task_map.insert(old_id, nid);
                }
            }

            // Copy task_labels
            for (old_task_id, new_task_id) in &task_map {
                let mut stmt = tx.prepare(
                    "SELECT label_id FROM task_labels WHERE task_id = ?1"
                )?;
                let lids: Vec<String> = stmt
                    .query_map(params![old_task_id], |row| row.get(0))?
                    .collect::<Result<_, _>>()?;
                for old_lid in lids {
                    if let Some(new_lid) = label_map.get(&old_lid) {
                        tx.execute(
                            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                            params![new_task_id, new_lid],
                        )?;
                    }
                }
            }

            // Copy subtasks
            for (old_task_id, new_task_id) in &task_map {
                let mut stmt = tx.prepare(
                    "SELECT title, position FROM subtasks WHERE task_id = ?1 ORDER BY position"
                )?;
                let subs: Vec<(String, i32)> = stmt
                    .query_map(params![old_task_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<Result<_, _>>()?;
                for (sub_title, sub_pos) in subs {
                    tx.execute(
                        "INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                        params![new_id(), new_task_id, sub_title, sub_pos, now],
                    )?;
                }
            }

            // Copy task_custom_field_values (composite PK: task_id, field_id)
            for (old_task_id, new_task_id) in &task_map {
                let mut stmt = tx.prepare(
                    "SELECT field_id, value FROM task_custom_field_values WHERE task_id = ?1"
                )?;
                let fvs: Vec<(String, String)> = stmt
                    .query_map(params![old_task_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .collect::<Result<_, _>>()?;
                for (old_fid, val) in fvs {
                    if let Some(new_fid) = field_map.get(&old_fid) {
                        tx.execute(
                            "INSERT INTO task_custom_field_values (task_id, field_id, value) VALUES (?1, ?2, ?3)",
                            params![new_task_id, new_fid, val],
                        )?;
                    }
                }
            }
        }

        tx.commit()?;

        Ok(Board {
            id: new_board_id,
            name: new_name,
            description: None,
            created_at: now_dt,
            updated_at: now_dt,
        })
    })
    .await
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat: add duplicate_board Db method"
```

### Task 5: REST handler for duplicate board

**Files:**
- Modify: `crates/server/src/api/boards.rs`
- Modify: `crates/server/src/api/mod.rs`

**Context:** `boards.rs` already imports `Board, Role` (line 10), `Deserialize` (line 5), `permissions` (line 13), `validation` (line 14). The existing `create` handler uses `validation::validate_title(&body.name)?` for board names.

- [ ] **Step 1: Add the `DuplicateBoardBody` struct and `duplicate` handler to `boards.rs`**

Add the struct after `UpdateBoard` (around line 28):

```rust
#[derive(Deserialize)]
pub struct DuplicateBoardBody {
    pub name: String,
    pub include_tasks: Option<bool>,
}
```

Add the handler after the existing `members` handler:

```rust
pub async fn duplicate(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<DuplicateBoardBody>,
) -> Result<Json<Board>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    validation::validate_title(&body.name)?;
    let include_tasks = body.include_tasks.unwrap_or(true);
    let board = db.duplicate_board(&board_id, &body.name, include_tasks, &user.id).await?;
    let _ = db.log_activity(
        &board.id,
        None,
        &user.id,
        "board_duplicated",
        Some(&serde_json::json!({"source_board_id": board_id}).to_string()),
    ).await;
    Ok(Json(board))
}
```

- [ ] **Step 2: Add the route to `mod.rs`**

Add `.route("/duplicate", post(boards::duplicate))` to the `per_board` router (around line 89, alongside `/members`, `/activity`, etc.).

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`

- [ ] **Step 4: Run tests**

Run: `cargo test -p kanwise-server 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/api/boards.rs crates/server/src/api/mod.rs
git commit -m "feat: add POST /boards/{id}/duplicate REST endpoint"
```

### Task 6: MCP `duplicate_board` action

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`
- Modify: `crates/server/src/mcp/sse.rs`

- [ ] **Step 1: Add `duplicate_board` match arm in `handle_mutate()`**

```rust
"duplicate_board" => {
    let name = json_str(data, "name")?;
    crate::api::validation::validate_title(name)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let include_tasks = data
        .get("include_tasks")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let user_id = data.get("user_id").and_then(Value::as_str).unwrap_or("mcp");
    let board = self.db.duplicate_board(board_id, name, include_tasks, user_id).await?;
    let _ = self.db.log_activity(
        &board.id,
        None,
        user_id,
        "board_duplicated",
        Some(&serde_json::json!({"source_board_id": board_id}).to_string()),
    ).await;
    Ok(format!("duplicated board {} as {}", board_id, board.id))
}
```

- [ ] **Step 2: Add `"duplicate_board"` to the action enum in `sse.rs`**

Same location as Task 3 Step 2 — add `"duplicate_board"` to the `enum` array.

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p kanwise-server 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/mcp/tools.rs crates/server/src/mcp/sse.rs
git commit -m "feat: add duplicate_board MCP action"
```

---

## Chunk 3: Frontend — API & Store

### Task 7: Frontend API methods

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Context:** API methods follow the pattern `methodName: (params) => request<ReturnType>('/path', { method, body })`. The `Task` interface already includes optional `labels?`, `subtask_count?`, `attachment_count?` fields, so it accommodates the `TaskWithRelations` response.

- [ ] **Step 1: Add `duplicateTask` and `duplicateBoard` methods**

Add `duplicateBoard` after the existing board methods (after `deleteBoard`, around line 38):

```typescript
duplicateBoard: (boardId: string, data: { name: string; include_tasks?: boolean }) =>
  request<Board>(`/boards/${boardId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
```

Add `duplicateTask` after the existing task methods (after `deleteTask`, around line 84):

```typescript
duplicateTask: (boardId: string, taskId: string) =>
  request<Task>(`/boards/${boardId}/tasks/${taskId}/duplicate`, { method: 'POST' }),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add duplicateTask and duplicateBoard API methods"
```

### Task 8: Board store methods

**Files:**
- Modify: `frontend/src/stores/board.ts`

**Context:** Store methods follow the pattern: call API, update state, show notification via `notify()`. The `BoardState` interface (line 6-57) defines method signatures.

- [ ] **Step 1: Add `duplicateTask` and `duplicateBoard` to the `BoardState` interface**

Add to the interface (around line 46, after `unarchiveColumn`):

```typescript
duplicateTask: (boardId: string, taskId: string) => Promise<Task>
duplicateBoard: (boardId: string, name: string, includeTasks?: boolean) => Promise<Board>
```

- [ ] **Step 2: Add implementations**

Add after the `deleteTask` implementation (around line 193):

```typescript
duplicateTask: async (boardId: string, taskId: string) => {
  const task = await api.duplicateTask(boardId, taskId)
  // Refetch all tasks to get correct positions after shift
  const tasks = await api.listTasks(boardId)
  set({ tasks })
  notify(`Task "${task.title}" created`)
  return task
},

duplicateBoard: async (boardId: string, name: string, includeTasks?: boolean) => {
  const board = await api.duplicateBoard(boardId, {
    name,
    include_tasks: includeTasks ?? true,
  })
  set({ boards: [...get().boards, board] })
  notify(`Board "${board.name}" created`)
  return board
},
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/board.ts
git commit -m "feat: add duplicateTask and duplicateBoard store methods"
```

---

## Chunk 4: Frontend — UI

### Task 9: Duplicate button in TaskEditor

**Files:**
- Modify: `frontend/src/components/board/TaskEditor.tsx`

**Context:** TaskEditor (line 52-568) renders a task detail view inside a dialog. The footer (line 551-565) has "Archive" and "Delete" buttons. `useBoardStore` is already imported. `lucide-react` icons are imported at line 20-27.

- [ ] **Step 1: Add the duplicate handler and icon import**

Add `Copy` to the lucide-react import (line 20-27, alongside `Archive`, `Trash2`, etc.).

Add the handler after `handleDelete` (around line 238):

```typescript
const handleDuplicate = async () => {
  if (!currentBoard) return
  try {
    await useBoardStore.getState().duplicateTask(currentBoard.id, task.id)
    onClose()
  } catch {
    addNotification('Failed to duplicate task')
  }
}
```

- [ ] **Step 2: Add the button in the footer**

In the footer `div` (line 555, the `div` with `className="flex items-center gap-2"`), add a "Duplicate" button BEFORE the "Archive" button:

```tsx
<Button variant="ghost" size="sm" onClick={handleDuplicate} className="gap-1.5 text-muted-foreground">
  <Copy className="size-3.5" />
  Duplicate
</Button>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/board/TaskEditor.tsx
git commit -m "feat: add Duplicate button to task editor"
```

### Task 10: Duplicate board in BoardPage header

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx`

**Context:** BoardPage (line 37-309) has a header (line 179-255) with buttons for Activity, Archives, and Settings (icon-only). Uses `useBoardStore` (already imported). Uses hash routing for navigation. Dialog components from `@/components/ui/dialog`. Input from `@/components/ui/input`.

- [ ] **Step 1: Add imports**

Add `Copy` to the lucide-react import (line 24). Add these imports at the top:

```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useNotificationStore } from '@/stores/notifications'
```

- [ ] **Step 2: Add state variables**

Add after the existing state (around line 49):

```typescript
const [duplicateOpen, setDuplicateOpen] = useState(false)
const [duplicateName, setDuplicateName] = useState('')
const [duplicateIncludeTasks, setDuplicateIncludeTasks] = useState(true)
const [duplicating, setDuplicating] = useState(false)
```

- [ ] **Step 3: Add the duplicate handler**

Add after the existing `handlePaletteAction` callback (around line 129):

```typescript
const handleDuplicateBoard = async () => {
  if (!duplicateName.trim() || duplicating) return
  setDuplicating(true)
  try {
    const board = await useBoardStore.getState().duplicateBoard(
      boardId,
      duplicateName.trim(),
      duplicateIncludeTasks,
    )
    setDuplicateOpen(false)
    window.location.hash = `#/boards/${board.id}`
  } catch {
    useNotificationStore.getState().add('Failed to duplicate board')
  } finally {
    setDuplicating(false)
  }
}
```

- [ ] **Step 4: Add the button in the header**

Add a "Duplicate" button before the Settings button (around line 240, before the `<Button ... aria-label="Board settings">`):

```tsx
<Button
  variant="ghost"
  size="xs"
  className="gap-1.5 text-xs text-muted-foreground"
  aria-label="Duplicate board"
  onClick={() => {
    setDuplicateName(`Copy of ${currentBoard.name}`)
    setDuplicateIncludeTasks(true)
    setDuplicateOpen(true)
  }}
>
  <Copy className="size-3.5" />
</Button>
```

- [ ] **Step 5: Add the dialog**

Add after the existing `ShortcutsDialog` (around line 304):

```tsx
<Dialog open={duplicateOpen} onOpenChange={(open) => { if (!open) setDuplicateOpen(false) }}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Duplicate board</DialogTitle>
    </DialogHeader>
    <div className="flex flex-col gap-4 py-2">
      <div>
        <label className="mb-1.5 block text-sm font-medium">Board name</label>
        <Input
          value={duplicateName}
          onChange={(e) => setDuplicateName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDuplicateBoard() }}
          autoFocus
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={duplicateIncludeTasks}
          onChange={(e) => setDuplicateIncludeTasks(e.target.checked)}
          className="rounded"
        />
        Include tasks
      </label>
    </div>
    <DialogFooter>
      <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(false)}>
        Cancel
      </Button>
      <Button size="sm" onClick={handleDuplicateBoard} disabled={!duplicateName.trim() || duplicating}>
        {duplicating ? 'Duplicating...' : 'Duplicate'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat: add Duplicate board button and dialog"
```

---

## Chunk 5: Verification

### Task 11: Full backend verification

**Files:** none (verification only)

- [ ] **Step 1: Run Rust tests**

Run: `cargo test -p kanwise-server 2>&1 | tail -30`
Expected: all tests pass.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy -p kanwise-server -- -D warnings 2>&1 | tail -30`
Expected: no warnings. Fix any that appear.

### Task 12: Full frontend verification

**Files:** none (verification only)

- [ ] **Step 1: TypeScript check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `cd frontend && npx eslint src --ext .ts,.tsx 2>&1 | tail -20`
Expected: no errors.

### Task 13: Sync pnpm lockfile

**Files:**
- Modify: `frontend/pnpm-lock.yaml` (only if needed)

- [ ] **Step 1: Verify lockfile is in sync**

Run: `cd frontend && corepack pnpm install --frozen-lockfile 2>&1 | tail -5`
Expected: success (no new deps expected for this lot).

- [ ] **Step 2: Final commit if lockfile changed**

Only if pnpm-lock.yaml changed:
```bash
git add frontend/pnpm-lock.yaml
git commit -m "chore: sync pnpm lockfile"
```
