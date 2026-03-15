# Lot 1: Labels, Due Dates, Subtasks — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add labels, due dates, and subtasks as foundational data primitives across the REST API, MCP/KBF, and React frontend.

**Architecture:** Three new DB tables (labels, task_labels, subtasks) + one ALTER (tasks.due_date) via migration v4. New REST endpoints for labels and subtasks. Extended MCP board_mutate actions and KBF v2 task schema. Frontend gains label management, date picker, and subtask list components.

**Tech Stack:** Rust (Axum, rusqlite), KBF crate, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, @dnd-kit, Zustand

**Spec:** `docs/superpowers/specs/2026-03-15-lot1-labels-dates-subtasks-design.md`

---

## Chunk 1: Backend — Database Layer

### Task 1: Migration v4

**Files:**
- Modify: `crates/server/src/db/migrations.rs`

- [ ] **Step 1: Add v4 migration function**

Add after `v3()`:

```rust
fn v4(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction().context("begin v4 transaction")?;
    tx.execute_batch(
        "
        -- Labels (per board, reusable across tasks)
        CREATE TABLE IF NOT EXISTS labels (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            color      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_board_name ON labels(board_id, name);

        -- Many-to-many: tasks <-> labels
        CREATE TABLE IF NOT EXISTS task_labels (
            task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

        -- Subtasks
        CREATE TABLE IF NOT EXISTS subtasks (
            id         TEXT PRIMARY KEY,
            task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            completed  INTEGER NOT NULL DEFAULT 0,
            position   INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

        -- Due date on tasks
        ALTER TABLE tasks ADD COLUMN due_date TEXT;

        -- Record migration
        INSERT INTO schema_version (version) VALUES (4);
        ",
    )
    .context("v4 migration")?;
    tx.commit().context("commit v4 migration")?;
    Ok(())
}
```

- [ ] **Step 2: Wire v4 into `run_migrations`**

In `run_migrations()`, after the `if current < 3` block, add:

```rust
    if current < 4 {
        v4(conn).context("applying migration v4")?;
    }
```

- [ ] **Step 3: Update migration tests**

Update `test_migrations_apply_cleanly`: change `assert_eq!(ver, 3)` to `assert_eq!(ver, 4)` and add table checks:

```rust
conn.execute_batch("SELECT 1 FROM labels LIMIT 0").unwrap();
conn.execute_batch("SELECT 1 FROM task_labels LIMIT 0").unwrap();
conn.execute_batch("SELECT 1 FROM subtasks LIMIT 0").unwrap();
conn.execute_batch("SELECT due_date FROM tasks LIMIT 0").unwrap();
```

Update `test_migrations_are_idempotent` and `test_migration_v2_applies_cleanly` to expect version 4.

- [ ] **Step 4: Run tests**

Run: `cargo test -p kanwise-server db::migrations`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/db/migrations.rs
git commit -m "feat: add migration v4 — labels, task_labels, subtasks tables + due_date column"
```

---

### Task 2: Models — Label, Subtask, TaskWithRelations

**Files:**
- Modify: `crates/server/src/db/models.rs`

- [ ] **Step 1: Add Label struct**

After the `ApiKey` struct, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Add Subtask struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub completed: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 3: Add due_date to Task struct**

In the `Task` struct, add after `assignee`:

```rust
    pub due_date: Option<String>,
```

- [ ] **Step 4: Add TaskWithRelations and SubtaskCount**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskCount {
    pub completed: i32,
    pub total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithRelations {
    #[serde(flatten)]
    pub task: Task,
    pub labels: Vec<Label>,
    pub subtask_count: SubtaskCount,
}
```

- [ ] **Step 5: Update map_task_row and get_task_inner to include due_date**

In `repo.rs`, update `map_task_row` to read `due_date` at index 10:

```rust
fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let priority_str: String = row.get(5)?;
    Ok(Task {
        id: row.get(0)?,
        board_id: row.get(1)?,
        column_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        priority: Priority::from_str_db(&priority_str).unwrap_or(Priority::Medium),
        assignee: row.get(6)?,
        due_date: row.get(7)?,
        position: row.get(8)?,
        created_at: parse_dt(&row.get::<_, String>(9)?)?,
        updated_at: parse_dt(&row.get::<_, String>(10)?)?,
    })
}
```

Update ALL SQL queries in `repo.rs` that SELECT from tasks to include `due_date` in the column list (after `assignee`, before `position`). This affects:
- `create_task` return (line ~275): the SELECT after INSERT
- `list_tasks` (line ~311): the SELECT
- `list_tasks_in_column` (line ~322): the SELECT
- `get_task_inner` (line ~420): the SELECT
- `move_task` return: relies on `get_task_inner`

The column list changes from:
`id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at`
to:
`id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at`

- [ ] **Step 6: Update create_task to include due_date in INSERT**

In `create_task`, add `due_date` as NULL in the INSERT and include it in the returned Task struct:

```rust
    pub fn create_task(
        &self,
        board_id: &str,
        column_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Priority,
        assignee: Option<&str>,
    ) -> anyhow::Result<Task> {
```

The INSERT stays the same (due_date defaults to NULL). Just ensure the returned `Task` struct includes `due_date: None`.

- [ ] **Step 7: Run tests**

Run: `cargo test -p kanwise-server`
Expected: All tests pass (compilation confirms model changes are consistent).

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/db/models.rs crates/server/src/db/repo.rs
git commit -m "feat: add Label, Subtask, TaskWithRelations models + due_date on Task"
```

---

### Task 3: Repo — Labels CRUD

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Add label CRUD methods**

Add a new `impl Db` block for labels:

```rust
// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_label(&self, board_id: &str, name: &str, color: &str) -> anyhow::Result<Label> {
        self.with_conn(|conn| {
            let id = new_id();
            let now = now_iso();
            conn.execute(
                "INSERT INTO labels (id, board_id, name, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, board_id, name, color, now],
            ).context("insert label")?;
            Ok(Label {
                id,
                board_id: board_id.to_string(),
                name: name.to_string(),
                color: color.to_string(),
                created_at: Utc::now(),
            })
        })
    }

    pub fn list_labels(&self, board_id: &str) -> anyhow::Result<Vec<Label>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, color, created_at FROM labels WHERE board_id = ?1 ORDER BY created_at",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }

    pub fn get_label(&self, id: &str) -> anyhow::Result<Option<Label>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, board_id, name, color, created_at FROM labels WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
    }

    pub fn update_label(&self, id: &str, name: Option<&str>, color: Option<&str>) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            if let Some(n) = name {
                sets.push("name = ?");
                values.push(Box::new(n.to_string()));
            }
            if let Some(c) = color {
                sets.push("color = ?");
                values.push(Box::new(c.to_string()));
            }
            if sets.is_empty() { return Ok(false); }
            values.push(Box::new(id.to_string()));
            let sql = format!("UPDATE labels SET {} WHERE id = ?", sets.join(", "));
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
            let affected = conn.execute(&sql, param_refs.as_slice())?;
            Ok(affected > 0)
        })
    }

    pub fn delete_label(&self, id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
    }

    pub fn add_task_label(&self, task_id: &str, label_id: &str) -> anyhow::Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                params![task_id, label_id],
            ).context("add task label")?;
            Ok(())
        })
    }

    pub fn remove_task_label(&self, task_id: &str, label_id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute(
                "DELETE FROM task_labels WHERE task_id = ?1 AND label_id = ?2",
                params![task_id, label_id],
            )?;
            Ok(affected > 0)
        })
    }

    pub fn get_task_labels(&self, task_id: &str) -> anyhow::Result<Vec<Label>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT l.id, l.board_id, l.name, l.color, l.created_at
                 FROM labels l
                 INNER JOIN task_labels tl ON tl.label_id = l.id
                 WHERE tl.task_id = ?1
                 ORDER BY l.name",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Label {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }

    /// Batch load labels for all tasks in a board (avoids N+1).
    pub fn get_labels_for_board_tasks(&self, board_id: &str) -> anyhow::Result<Vec<(String, Label)>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT tl.task_id, l.id, l.board_id, l.name, l.color, l.created_at
                 FROM task_labels tl
                 INNER JOIN labels l ON l.id = tl.label_id
                 WHERE l.board_id = ?1
                 ORDER BY l.name",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let task_id: String = row.get(0)?;
                let label = Label {
                    id: row.get(1)?,
                    board_id: row.get(2)?,
                    name: row.get(3)?,
                    color: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                };
                Ok((task_id, label))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p kanwise-server`
Expected: Compiles and existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat: add label CRUD + task_labels repo methods"
```

---

### Task 4: Repo — Subtasks CRUD

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Add subtask CRUD methods**

```rust
// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

impl Db {
    pub fn create_subtask(&self, task_id: &str, title: &str) -> anyhow::Result<Subtask> {
        self.with_conn(|conn| {
            let id = new_id();
            let now = now_iso();
            let position: i32 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM subtasks WHERE task_id = ?1",
                    params![task_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
                params![id, task_id, title, position, now],
            ).context("insert subtask")?;
            Ok(Subtask {
                id,
                task_id: task_id.to_string(),
                title: title.to_string(),
                completed: false,
                position,
                created_at: Utc::now(),
            })
        })
    }

    pub fn list_subtasks(&self, task_id: &str) -> anyhow::Result<Vec<Subtask>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE task_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![task_id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }

    pub fn get_subtask(&self, id: &str) -> anyhow::Result<Option<Subtask>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
    }

    pub fn update_subtask(
        &self,
        id: &str,
        title: Option<&str>,
        completed: Option<bool>,
        position: Option<i32>,
    ) -> anyhow::Result<Option<Subtask>> {
        self.with_conn(|conn| {
            let mut sets = Vec::new();
            let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            if let Some(t) = title {
                sets.push("title = ?");
                values.push(Box::new(t.to_string()));
            }
            if let Some(c) = completed {
                sets.push("completed = ?");
                values.push(Box::new(c as i32));
            }
            if let Some(p) = position {
                sets.push("position = ?");
                values.push(Box::new(p));
            }
            if !sets.is_empty() {
                values.push(Box::new(id.to_string()));
                let sql = format!("UPDATE subtasks SET {} WHERE id = ?", sets.join(", "));
                let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
                conn.execute(&sql, param_refs.as_slice())?;
            }
            // Return updated subtask
            let mut stmt = conn.prepare(
                "SELECT id, task_id, title, completed, position, created_at FROM subtasks WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], |row| {
                Ok(Subtask {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    completed: row.get::<_, i32>(3)? != 0,
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            })?;
            match rows.next() {
                Some(r) => Ok(Some(r?)),
                None => Ok(None),
            }
        })
    }

    pub fn delete_subtask(&self, id: &str) -> anyhow::Result<bool> {
        self.with_conn(|conn| {
            let affected = conn.execute("DELETE FROM subtasks WHERE id = ?1", params![id])?;
            Ok(affected > 0)
        })
    }

    /// Get subtask counts for all tasks in a board (avoids N+1).
    pub fn get_subtask_counts_for_board(&self, board_id: &str) -> anyhow::Result<Vec<(String, SubtaskCount)>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT s.task_id, COUNT(*) as total, SUM(s.completed) as done
                 FROM subtasks s
                 INNER JOIN tasks t ON t.id = s.task_id
                 WHERE t.board_id = ?1
                 GROUP BY s.task_id",
            )?;
            let rows = stmt.query_map(params![board_id], |row| {
                let task_id: String = row.get(0)?;
                let total: i32 = row.get(1)?;
                let completed: i32 = row.get(2)?;
                Ok((task_id, SubtaskCount { completed, total }))
            })?;
            let mut out = Vec::new();
            for r in rows { out.push(r?); }
            Ok(out)
        })
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p kanwise-server`
Expected: Compiles and passes.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat: add subtask CRUD + batch subtask counts repo methods"
```

---

### Task 5: Repo — update_task with due_date

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Add due_date parameter to update_task**

Change the signature to:

```rust
    pub fn update_task(
        &self,
        id: &str,
        title: Option<&str>,
        description: Option<Option<&str>>,
        priority: Option<Priority>,
        assignee: Option<Option<&str>>,
        due_date: Option<Option<&str>>,
    ) -> anyhow::Result<Option<Task>> {
```

Add inside the body, after the `assignee` block:

```rust
            if let Some(d) = due_date {
                sets.push("due_date = ?");
                values.push(Box::new(d.map(|s| s.to_string())));
            }
```

- [ ] **Step 2: Update all call sites**

In `crates/server/src/api/tasks.rs`, `update` handler (line ~118):
```rust
        .update_task(
            &tid,
            body.title.as_deref(),
            description,
            body.priority,
            assignee,
            body.due_date.as_ref().map(|d| d.as_deref()),
        )?
```

And add `due_date` to `UpdateTask`:
```rust
#[derive(Deserialize)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub priority: Option<Priority>,
    pub assignee: Option<Option<String>>,
    pub due_date: Option<Option<String>>,
}
```

In `crates/server/src/mcp/tools.rs`, `update_task` action (~line 190):
```rust
                let due_date = data
                    .get("due_date")
                    .map(|v| v.as_str());

                let task = self
                    .db
                    .update_task(task_id, title, description, priority, assignee, due_date)?
```

In `apply_field_update` (~line 396-418), update all existing arms to pass `None` as the 6th param, and add new arm:
```rust
            "due" => {
                let due = if value.is_empty() { Some(None) } else { Some(Some(value)) };
                self.db.update_task(task_id, None, None, None, None, due)?;
            }
```

All other `apply_field_update` arms (`"title"`, `"desc"`, `"pri"`, `"who"`) need the extra `None` at the end:
```rust
            "title" => {
                self.db.update_task(task_id, Some(value), None, None, None, None)?;
            }
            "desc" => {
                self.db.update_task(task_id, None, Some(Some(value)), None, None, None)?;
            }
            "pri" => {
                let priority = kbf_bridge::priority_from_short_or_full(value)
                    .ok_or_else(|| anyhow::anyhow!("invalid priority: {value}"))?;
                self.db.update_task(task_id, None, None, Some(priority), None, None)?;
            }
            "who" => {
                let assignee = if value.is_empty() { Some(None) } else { Some(Some(value)) };
                self.db.update_task(task_id, None, None, None, assignee, None)?;
            }
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p kanwise-server`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/db/repo.rs crates/server/src/api/tasks.rs crates/server/src/mcp/tools.rs
git commit -m "feat: add due_date to update_task across repo, API, and MCP"
```

---

## Chunk 2: Backend — REST API Handlers

### Task 6: API — Labels handlers

**Files:**
- Create: `crates/server/src/api/labels.rs`
- Modify: `crates/server/src/api/mod.rs`

- [ ] **Step 1: Create labels.rs**

```rust
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Label, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

// Color validation: must be #RRGGBB hex
fn is_valid_color(s: &str) -> bool {
    s.len() == 7
        && s.starts_with('#')
        && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Deserialize)]
pub struct CreateLabel {
    pub name: String,
    pub color: String,
}

#[derive(Deserialize)]
pub struct UpdateLabel {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Deserialize)]
pub struct AttachLabel {
    pub label_id: String,
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<Label>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let labels = db.list_labels(&board_id)?;
    Ok(Json(labels))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<CreateLabel>,
) -> Result<Json<Label>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    if body.name.trim().is_empty() || body.name.len() > 50 {
        return Err(ApiError::BadRequest("label name must be 1-50 characters".into()));
    }
    if !is_valid_color(&body.color) {
        return Err(ApiError::BadRequest("color must be #RRGGBB hex format".into()));
    }
    let label = db.create_label(&board_id, body.name.trim(), &body.color)?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_created",
        Some(&serde_json::json!({"name": &label.name, "color": &label.color}).to_string()),
    );
    Ok(Json(label))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, label_id)): Path<(String, String)>,
    Json(body): Json<UpdateLabel>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("label not found".into()));
    }
    if let Some(ref c) = body.color {
        if !is_valid_color(c) {
            return Err(ApiError::BadRequest("color must be #RRGGBB hex format".into()));
        }
    }
    db.update_label(&label_id, body.name.as_deref(), body.color.as_deref())?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_updated",
        Some(&serde_json::json!({"name": existing.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"updated": true})))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, label_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if existing.board_id != board_id {
        return Err(ApiError::NotFound("label not found".into()));
    }
    db.delete_label(&label_id)?;
    let _ = db.log_activity(
        &board_id, None, &user.id, "label_deleted",
        Some(&serde_json::json!({"name": existing.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"deleted": true})))
}

pub async fn attach(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
    Json(body): Json<AttachLabel>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let label = db.get_label(&body.label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    if label.board_id != board_id { return Err(ApiError::NotFound("label not found".into())); }
    db.add_task_label(&task_id, &body.label_id)?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "label_added",
        Some(&serde_json::json!({"task_title": task.title, "label_name": label.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"ok": true})))
}

pub async fn detach(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, label_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let label = db.get_label(&label_id)?.ok_or_else(|| ApiError::NotFound("label not found".into()))?;
    db.remove_task_label(&task_id, &label_id)?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "label_removed",
        Some(&serde_json::json!({"task_title": task.title, "label_name": label.name}).to_string()),
    );
    Ok(Json(serde_json::json!({"ok": true})))
}
```

- [ ] **Step 2: Register labels module and routes in mod.rs**

Add `pub mod labels;` to the module declarations.

Add label routes in the `router()` function. After `task_item` definition, add label routes to it:

```rust
    let task_labels = Router::new()
        .route("/", post(labels::attach))
        .route("/{lid}", axum::routing::delete(labels::detach));
```

Add to `task_item`:
```rust
        .nest("/labels", task_labels)
```

Add board-level label routes:
```rust
    let board_labels = Router::new()
        .route("/", get(labels::list).post(labels::create))
        .route("/{lid}", put(labels::update).delete(labels::delete));
```

Add to `per_board`:
```rust
        .nest("/labels", board_labels)
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p kanwise-server`
Expected: Compiles and passes.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/api/labels.rs crates/server/src/api/mod.rs
git commit -m "feat: add REST API handlers for labels CRUD + task label attach/detach"
```

---

### Task 7: API — Subtasks handlers

**Files:**
- Create: `crates/server/src/api/subtasks.rs`
- Modify: `crates/server/src/api/mod.rs`

- [ ] **Step 1: Create subtasks.rs**

```rust
use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;

use crate::db::Db;
use crate::db::models::{Role, Subtask};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

#[derive(Deserialize)]
pub struct CreateSubtask {
    pub title: String,
}

#[derive(Deserialize)]
pub struct UpdateSubtask {
    pub title: Option<String>,
    pub completed: Option<bool>,
    pub position: Option<i32>,
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
) -> Result<Json<Vec<Subtask>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let subtasks = db.list_subtasks(&task_id)?;
    Ok(Json(subtasks))
}

pub async fn create(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
    Json(body): Json<CreateSubtask>,
) -> Result<Json<Subtask>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    if body.title.trim().is_empty() || body.title.len() > 200 {
        return Err(ApiError::BadRequest("subtask title must be 1-200 characters".into()));
    }
    let subtask = db.create_subtask(&task_id, body.title.trim())?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "subtask_created",
        Some(&serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title}).to_string()),
    );
    Ok(Json(subtask))
}

pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, subtask_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateSubtask>,
) -> Result<Json<Subtask>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let existing = db.get_subtask(&subtask_id)?.ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;
    if existing.task_id != task_id { return Err(ApiError::NotFound("subtask not found".into())); }

    let was_completed = existing.completed;
    let subtask = db
        .update_subtask(&subtask_id, body.title.as_deref(), body.completed, body.position)?
        .ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;

    // Log completion/uncompletion
    if let Some(completed) = body.completed {
        if completed && !was_completed {
            let _ = db.log_activity(
                &board_id, Some(&task_id), &user.id, "subtask_completed",
                Some(&serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title}).to_string()),
            );
        } else if !completed && was_completed {
            let _ = db.log_activity(
                &board_id, Some(&task_id), &user.id, "subtask_uncompleted",
                Some(&serde_json::json!({"task_title": task.title, "subtask_title": &subtask.title}).to_string()),
            );
        }
    }

    Ok(Json(subtask))
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id, subtask_id)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&task_id)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let existing = db.get_subtask(&subtask_id)?.ok_or_else(|| ApiError::NotFound("subtask not found".into()))?;
    if existing.task_id != task_id { return Err(ApiError::NotFound("subtask not found".into())); }
    db.delete_subtask(&subtask_id)?;
    let _ = db.log_activity(
        &board_id, Some(&task_id), &user.id, "subtask_deleted",
        Some(&serde_json::json!({"task_title": task.title, "subtask_title": existing.title}).to_string()),
    );
    Ok(Json(serde_json::json!({"deleted": true})))
}
```

- [ ] **Step 2: Register subtasks module and routes**

Add `pub mod subtasks;` to mod.rs module declarations.

Add subtask routes to `task_item`:
```rust
    let task_subtasks = Router::new()
        .route("/", get(subtasks::list).post(subtasks::create))
        .route("/{sid}", put(subtasks::update).delete(subtasks::delete));
```

Add to `task_item`:
```rust
        .nest("/subtasks", task_subtasks)
```

- [ ] **Step 3: Run tests**

Run: `cargo test -p kanwise-server`
Expected: Compiles and passes.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/api/subtasks.rs crates/server/src/api/mod.rs
git commit -m "feat: add REST API handlers for subtasks CRUD with activity logging"
```

---

### Task 8: API — Tasks response with relations

**Files:**
- Modify: `crates/server/src/api/tasks.rs`

- [ ] **Step 1: Update task list handler to return TaskWithRelations**

Change `list` handler return type to `Json<Vec<TaskWithRelations>>` and enrich tasks:

```rust
use crate::db::models::{Priority, Role, Task, TaskWithRelations, SubtaskCount};
use std::collections::HashMap;

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Query(params): Query<ListTasksParams>,
) -> Result<Json<Vec<TaskWithRelations>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let limit = params.limit.unwrap_or(100).min(500);
    let offset = params.offset.unwrap_or(0).max(0);
    let tasks = db.list_tasks(&board_id, limit, offset)?;

    // Batch load labels and subtask counts
    let label_pairs = db.get_labels_for_board_tasks(&board_id)?;
    let mut labels_by_task: HashMap<String, Vec<_>> = HashMap::new();
    for (task_id, label) in label_pairs {
        labels_by_task.entry(task_id).or_default().push(label);
    }

    let subtask_counts = db.get_subtask_counts_for_board(&board_id)?;
    let mut counts_by_task: HashMap<String, SubtaskCount> = HashMap::new();
    for (task_id, count) in subtask_counts {
        counts_by_task.insert(task_id, count);
    }

    let result: Vec<TaskWithRelations> = tasks
        .into_iter()
        .map(|task| {
            let labels = labels_by_task.remove(&task.id).unwrap_or_default();
            let subtask_count = counts_by_task.remove(&task.id).unwrap_or(SubtaskCount { completed: 0, total: 0 });
            TaskWithRelations { task, labels, subtask_count }
        })
        .collect();

    Ok(Json(result))
}
```

- [ ] **Step 2: Update task get handler similarly**

```rust
pub async fn get(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<TaskWithRelations>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let task = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    let labels = db.get_task_labels(&tid)?;
    let subtasks = db.list_subtasks(&tid)?;
    let subtask_count = SubtaskCount {
        completed: subtasks.iter().filter(|s| s.completed).count() as i32,
        total: subtasks.len() as i32,
    };
    Ok(Json(TaskWithRelations { task, labels, subtask_count }))
}
```

- [ ] **Step 3: Add due_date activity logging to update handler**

In the `update` handler, after the existing activity log call, add due_date logging:

```rust
    // Log due_date changes
    if body.due_date.is_some() {
        let action = if task.due_date.is_some() { "due_date_set" } else { "due_date_removed" };
        let details = if let Some(ref d) = task.due_date {
            serde_json::json!({"task_title": &task.title, "due_date": d})
        } else {
            serde_json::json!({"task_title": &task.title})
        };
        let _ = db.log_activity(&board_id, Some(&tid), &user.id, action, Some(&details.to_string()));
    }
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p kanwise-server`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/api/tasks.rs
git commit -m "feat: return TaskWithRelations from task list/get + due_date activity logging"
```

---

## Chunk 3: Backend — MCP & KBF

### Task 9: KBF — Label and subtask schemas + encoding

**Files:**
- Modify: `crates/server/src/mcp/kbf_bridge.rs`

- [ ] **Step 1: Bump task schema to v2 with new fields**

Update `task_schema()`:

```rust
pub fn task_schema(db: &Db, board_id: &str) -> Result<kbf::Schema> {
    let base = vec![
        "id".to_string(),
        "col".to_string(),
        "title".to_string(),
        "desc".to_string(),
        "pri".to_string(),
        "who".to_string(),
        "pos".to_string(),
        "due".to_string(),
        "labels".to_string(),
        "subtasks".to_string(),
    ];

    let custom_fields = db
        .list_custom_fields(board_id)
        .context("list custom fields for task schema")?;

    let mut fields = base;
    for cf in &custom_fields {
        fields.push(cf.name.clone());
    }

    let mut schema = kbf::Schema::new("task", fields);
    schema.version = 2;
    Ok(schema)
}
```

- [ ] **Step 2: Add label and subtask schemas**

```rust
pub fn label_schema() -> kbf::Schema {
    kbf::Schema::new("label", vec!["id", "name", "color"])
}

pub fn subtask_schema() -> kbf::Schema {
    kbf::Schema::new("subtask", vec!["id", "task_id", "title", "done", "pos"])
}
```

- [ ] **Step 3: Add encode_board_labels and encode_task_subtasks**

```rust
pub fn encode_board_labels(db: &Db, board_id: &str) -> Result<String> {
    let schema = label_schema();
    let labels = db.list_labels(board_id).context("list labels for KBF encoding")?;
    let rows: Vec<kbf::Row> = labels
        .iter()
        .map(|l| vec![l.id.clone(), l.name.clone(), l.color.clone()])
        .collect();
    Ok(kbf::encode_full(&schema, &rows))
}

pub fn encode_task_subtasks(db: &Db, task_id: &str) -> Result<String> {
    let schema = subtask_schema();
    let subtasks = db.list_subtasks(task_id).context("list subtasks for KBF encoding")?;
    let rows: Vec<kbf::Row> = subtasks
        .iter()
        .map(|s| {
            vec![
                s.id.clone(),
                s.task_id.clone(),
                s.title.clone(),
                if s.completed { "1".to_string() } else { "0".to_string() },
                s.position.to_string(),
            ]
        })
        .collect();
    Ok(kbf::encode_full(&schema, &rows))
}
```

- [ ] **Step 4: Update encode_board_tasks to include due, labels, subtasks**

Modify `encode_board_tasks` to batch-load labels and subtask counts and append them to each row:

```rust
pub fn encode_board_tasks(db: &Db, board_id: &str) -> Result<String> {
    let schema = task_schema(db, board_id)?;
    let tasks = db.list_tasks(board_id, i64::MAX, 0).context("list tasks for KBF encoding")?;
    let custom_fields = db.list_custom_fields(board_id).context("list custom fields")?;

    // Batch load custom field values
    let all_cf_values = if !custom_fields.is_empty() {
        db.get_custom_field_values_for_board(board_id).context("batch load custom field values")?
    } else {
        Vec::new()
    };
    let mut cf_by_task: HashMap<&str, Vec<&crate::db::models::TaskCustomFieldValue>> = HashMap::new();
    for v in &all_cf_values {
        cf_by_task.entry(&v.task_id).or_default().push(v);
    }

    // Batch load labels per task
    let label_pairs = db.get_labels_for_board_tasks(board_id).context("batch load labels")?;
    let mut labels_by_task: HashMap<&str, Vec<&str>> = HashMap::new();
    for (task_id, label) in &label_pairs {
        labels_by_task.entry(task_id.as_str()).or_default().push(label.id.as_str());
    }

    // Batch load subtask counts
    let subtask_counts = db.get_subtask_counts_for_board(board_id).context("batch load subtask counts")?;
    let mut counts_by_task: HashMap<&str, &crate::db::models::SubtaskCount> = HashMap::new();
    for (task_id, count) in &subtask_counts {
        counts_by_task.insert(task_id.as_str(), count);
    }

    let mut rows: Vec<kbf::Row> = Vec::with_capacity(tasks.len());

    for task in &tasks {
        let label_ids = labels_by_task
            .get(task.id.as_str())
            .map(|ids| ids.join(","))
            .unwrap_or_default();

        let subtask_str = counts_by_task
            .get(task.id.as_str())
            .map(|c| format!("{}/{}", c.completed, c.total))
            .unwrap_or_default();

        let mut row = vec![
            task.id.clone(),
            task.column_id.clone(),
            task.title.clone(),
            task.description.clone().unwrap_or_default(),
            task.priority.short().to_string(),
            task.assignee.clone().unwrap_or_default(),
            task.position.to_string(),
            task.due_date.clone().unwrap_or_default(),
            label_ids,
            subtask_str,
        ];

        // Append custom field values
        if !custom_fields.is_empty() {
            let task_vals = cf_by_task.get(task.id.as_str());
            let val_map: HashMap<&str, &str> = task_vals
                .map(|vals| vals.iter().map(|v| (v.field_id.as_str(), v.value.as_str())).collect())
                .unwrap_or_default();
            for cf in &custom_fields {
                row.push(val_map.get(cf.id.as_str()).unwrap_or(&"").to_string());
            }
        }

        rows.push(row);
    }

    Ok(kbf::encode_full(&schema, &rows))
}
```

- [ ] **Step 5: Update encode_board_all to include labels**

```rust
pub fn encode_board_all(db: &Db, board_id: &str) -> Result<String> {
    let info = encode_board_info(db, board_id)?;
    let cols = encode_board_columns(db, board_id)?;
    let labels = encode_board_labels(db, board_id)?;
    let tasks = encode_board_tasks(db, board_id)?;

    Ok(format!("{}\n\n{}\n\n{}\n\n{}", info, cols, labels, tasks))
}
```

- [ ] **Step 6: Update KBF tests**

Update `test_task_schema_base_fields` to expect v2 and the new fields:
```rust
    assert_eq!(schema.version, 2);
    assert_eq!(
        schema.fields,
        vec!["id", "col", "title", "desc", "pri", "who", "pos", "due", "labels", "subtasks"]
    );
```

Update `test_encode_board_tasks_basic` to expect `#task@v2:...` header.

- [ ] **Step 7: Run tests**

Run: `cargo test -p kanwise-server mcp`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/mcp/kbf_bridge.rs
git commit -m "feat: KBF v2 task schema + label/subtask encoding functions"
```

---

### Task 10: MCP — New query scopes and mutate actions

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`

- [ ] **Step 1: Add task_id to BoardQueryParams**

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardQueryParams {
    pub board_id: String,
    pub scope: Option<String>,
    pub format: Option<String>,
    pub task_id: Option<String>,
}
```

- [ ] **Step 2: Add labels and subtasks scopes to query_kbf**

In `query_kbf`, add new match arms:

```rust
            "labels" => kbf_bridge::encode_board_labels(&self.db, board_id),
            "subtasks" => {
                let task_id = params.task_id.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("task_id required for subtasks scope"))?;
                // Verify task belongs to board
                let task = self.db.get_task(task_id)?
                    .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
                if task.board_id != *board_id {
                    bail!("task {task_id} does not belong to board {board_id}");
                }
                kbf_bridge::encode_task_subtasks(&self.db, task_id)
            }
```

Update `query_json` similarly for "labels" and "subtasks" scopes:

```rust
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
```

Note: `query_kbf` and `query_json` need access to `params` (not just `board_id` and `scope`). Refactor the signature of these methods to accept `&BoardQueryParams` instead of separate `board_id` and `scope` args, or pass `task_id` through.

- [ ] **Step 3: Add new mutate actions**

In `handle_mutate`, before the `other => bail!("unknown action")` arm, add:

```rust
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
```

- [ ] **Step 4: Update MCP tool schemas in rmcp integration**

Find where the MCP tool definitions are declared (likely in the `#[tool]` macros or tool description strings) and update:
- `board_query`: add `task_id` parameter description
- `board_mutate`: add new action descriptions in the tool's help text

- [ ] **Step 5: Run tests**

Run: `cargo test -p kanwise-server`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/mcp/tools.rs
git commit -m "feat: MCP new query scopes (labels, subtasks) + 8 new mutate actions"
```

---

## Chunk 4: Frontend

### Task 11: Frontend — Types + API client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add Label and Subtask types**

After the `Task` interface:

```typescript
export interface Label {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  completed: boolean
  position: number
  created_at: string
}

export interface SubtaskCount {
  completed: number
  total: number
}
```

- [ ] **Step 2: Update Task interface**

Add to the existing `Task` interface:

```typescript
export interface Task {
  // ... existing fields
  due_date?: string | null
  labels?: Label[]
  subtask_count?: SubtaskCount
}
```

- [ ] **Step 3: Add API methods**

Add to the `api` object:

```typescript
  // Labels
  listLabels: (boardId: string) =>
    request<Label[]>(`/boards/${boardId}/labels`),
  createLabel: (boardId: string, data: { name: string; color: string }) =>
    request<Label>(`/boards/${boardId}/labels`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateLabel: (boardId: string, labelId: string, data: { name?: string; color?: string }) =>
    request<Label>(`/boards/${boardId}/labels/${labelId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteLabel: (boardId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/labels/${labelId}`, { method: 'DELETE' }),
  addTaskLabel: (boardId: string, taskId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/labels`, {
      method: 'POST', body: JSON.stringify({ label_id: labelId }),
    }),
  removeTaskLabel: (boardId: string, taskId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/labels/${labelId}`, { method: 'DELETE' }),

  // Subtasks
  listSubtasks: (boardId: string, taskId: string) =>
    request<Subtask[]>(`/boards/${boardId}/tasks/${taskId}/subtasks`),
  createSubtask: (boardId: string, taskId: string, data: { title: string }) =>
    request<Subtask>(`/boards/${boardId}/tasks/${taskId}/subtasks`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateSubtask: (boardId: string, taskId: string, subtaskId: string, data: { title?: string; completed?: boolean; position?: number }) =>
    request<Subtask>(`/boards/${boardId}/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteSubtask: (boardId: string, taskId: string, subtaskId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' }),
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add Label, Subtask types + API client methods"
```

---

### Task 12: Frontend — Zustand store additions

**Files:**
- Modify: `frontend/src/stores/board.ts`

- [ ] **Step 1: Add labels state and fetch**

Add `labels: Label[]` to `BoardState` interface and initial state.

In `fetchBoard`, add `api.listLabels(id)` to the `Promise.all`:

```typescript
const [board, columns, tasks, fields, members, labels] = await Promise.all([
  api.getBoard(id),
  api.listColumns(id),
  api.listTasks(id),
  api.listFields(id),
  api.listMembers(id),
  api.listLabels(id),
])
set({ currentBoard: board, columns, tasks, fields, members, labels, loading: false })
```

Add label management actions:

```typescript
  createLabel: async (boardId: string, name: string, color: string) => {
    const label = await api.createLabel(boardId, { name, color })
    set({ labels: [...get().labels, label] })
    return label
  },
  updateLabel: async (boardId: string, labelId: string, data: { name?: string; color?: string }) => {
    await api.updateLabel(boardId, labelId, data)
    set({
      labels: get().labels.map((l) =>
        l.id === labelId ? { ...l, ...data } : l
      ),
    })
  },
  deleteLabel: async (boardId: string, labelId: string) => {
    await api.deleteLabel(boardId, labelId)
    set({ labels: get().labels.filter((l) => l.id !== labelId) })
  },
  addTaskLabel: async (boardId: string, taskId: string, labelId: string) => {
    await api.addTaskLabel(boardId, taskId, labelId)
    const label = get().labels.find((l) => l.id === labelId)
    if (!label) return
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, labels: [...(t.labels ?? []), label] }
          : t
      ),
    })
  },
  removeTaskLabel: async (boardId: string, taskId: string, labelId: string) => {
    await api.removeTaskLabel(boardId, taskId, labelId)
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, labels: (t.labels ?? []).filter((l) => l.id !== labelId) }
          : t
      ),
    })
  },
```

Update `clearCurrentBoard` to include `labels: []`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/stores/board.ts
git commit -m "feat: add labels state + CRUD actions to board store"
```

---

### Task 13: Frontend — TaskCard enhancements

**Files:**
- Modify: `frontend/src/components/board/TaskCard.tsx`

- [ ] **Step 1: Add label pills, due date badge, and subtask indicator**

After the title `<p>`, add label pills:

```tsx
{/* Labels */}
{task.labels && task.labels.length > 0 && (
  <div className="mt-1.5 flex flex-wrap gap-1">
    {task.labels.slice(0, 3).map((label) => (
      <span
        key={label.id}
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium text-white"
        style={{ backgroundColor: label.color }}
      >
        {label.name}
      </span>
    ))}
    {task.labels.length > 3 && (
      <span className="text-[0.6rem] text-muted-foreground">
        +{task.labels.length - 3}
      </span>
    )}
  </div>
)}
```

In the metadata row, add subtask indicator before the spacer:

```tsx
{/* Subtask progress */}
{task.subtask_count && task.subtask_count.total > 0 && (
  <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
    <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 8l4 4 8-8" />
    </svg>
    {task.subtask_count.completed}/{task.subtask_count.total}
  </div>
)}
```

After the spacer, before assignee, add due date:

```tsx
{/* Due date */}
{task.due_date && (
  <span className={cn(
    'text-[0.6rem] font-medium',
    new Date(task.due_date) < new Date() ? 'text-red-500' :
    new Date(task.due_date).getTime() - Date.now() < 2 * 86400000 ? 'text-orange-500' :
    'text-muted-foreground'
  )}>
    {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
  </span>
)}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx
git commit -m "feat: TaskCard shows label pills, due date badge, subtask progress"
```

---

### Task 14: Frontend — LabelPicker component

**Files:**
- Create: `frontend/src/components/board/LabelPicker.tsx`

- [ ] **Step 1: Create LabelPicker**

A popover with checkboxes for existing labels + inline create:

```tsx
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'
import { Tag, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Label } from '@/lib/api'

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

interface LabelPickerProps {
  taskId: string
  taskLabels: Label[]
}

export function LabelPicker({ taskId, taskLabels }: LabelPickerProps) {
  const { currentBoard, labels, createLabel, addTaskLabel, removeTaskLabel } = useBoardStore()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])

  if (!currentBoard) return null

  const taskLabelIds = new Set(taskLabels.map((l) => l.id))

  const toggle = async (labelId: string) => {
    if (taskLabelIds.has(labelId)) {
      await removeTaskLabel(currentBoard.id, taskId, labelId)
    } else {
      await addTaskLabel(currentBoard.id, taskId, labelId)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const label = await createLabel(currentBoard.id, newName.trim(), newColor)
    await addTaskLabel(currentBoard.id, taskId, label.id)
    setNewName('')
    setCreating(false)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-wrap items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/50"
        >
          {taskLabels.length > 0 ? (
            taskLabels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: l.color }}
              >
                {l.name}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Add labels...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex flex-col gap-1">
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50',
                taskLabelIds.has(label.id) && 'bg-muted',
              )}
              onClick={() => toggle(label.id)}
            >
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
              {taskLabelIds.has(label.id) && (
                <svg className="ml-auto size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              )}
            </button>
          ))}

          {creating ? (
            <div className="mt-1 flex flex-col gap-2 border-t pt-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="Label name"
                className="h-7 text-sm"
                autoFocus
              />
              <div className="flex gap-1">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      'size-5 rounded-full border-2',
                      newColor === c ? 'border-foreground' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleCreate}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-1 flex items-center gap-2 border-t pt-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" />
              Create label
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/LabelPicker.tsx
git commit -m "feat: LabelPicker component — multi-select + inline create"
```

---

### Task 15: Frontend — SubtaskList component

**Files:**
- Create: `frontend/src/components/board/SubtaskList.tsx`

- [ ] **Step 1: Create SubtaskList**

```tsx
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { Subtask } from '@/lib/api'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import { Input } from '@/components/ui/input'
import { ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SubtaskListProps {
  taskId: string
}

export function SubtaskList({ taskId }: SubtaskListProps) {
  const { currentBoard } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [open, setOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (!currentBoard) return
    api.listSubtasks(currentBoard.id, taskId).then(setSubtasks).catch(() => {})
  }, [currentBoard, taskId])

  if (!currentBoard) return null

  const completed = subtasks.filter((s) => s.completed).length
  const total = subtasks.length

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    try {
      const subtask = await api.createSubtask(currentBoard.id, taskId, { title: newTitle.trim() })
      setSubtasks((prev) => [...prev, subtask])
      setNewTitle('')
    } catch {
      addNotification('Failed to add subtask')
    }
  }

  const handleToggle = async (subtask: Subtask) => {
    try {
      const updated = await api.updateSubtask(currentBoard.id, taskId, subtask.id, {
        completed: !subtask.completed,
      })
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? updated : s)))
    } catch {
      addNotification('Failed to update subtask')
    }
  }

  const handleDelete = async (subtaskId: string) => {
    try {
      await api.deleteSubtask(currentBoard.id, taskId, subtaskId)
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId))
    } catch {
      addNotification('Failed to delete subtask')
    }
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        Subtasks
        {total > 0 && (
          <span className="text-xs text-muted-foreground/70">
            ({completed}/{total})
          </span>
        )}
      </button>

      {total > 0 && (
        <div className="mt-1 ml-6 h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-1 pl-6">
          {subtasks.map((subtask) => (
            <div key={subtask.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/30">
              <input
                type="checkbox"
                checked={subtask.completed}
                onChange={() => handleToggle(subtask)}
                className="size-4 rounded border-muted-foreground/30"
              />
              <span className={cn('flex-1 text-sm', subtask.completed && 'text-muted-foreground line-through')}>
                {subtask.title}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(subtask.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}

          <div className="mt-1">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder="Add subtask..."
              className="h-7 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/SubtaskList.tsx
git commit -m "feat: SubtaskList component — collapsible checklist with add/toggle/delete"
```

---

### Task 16: Frontend — TaskEditor integration

**Files:**
- Modify: `frontend/src/components/board/TaskEditor.tsx`

- [ ] **Step 1: Add LabelPicker and SubtaskList to TaskEditor**

Import the new components:
```tsx
import { LabelPicker } from '@/components/board/LabelPicker'
import { SubtaskList } from '@/components/board/SubtaskList'
```

In the property rows grid, after the Assignee row, add:

```tsx
{/* Labels */}
<span className="text-muted-foreground">Labels</span>
<div>
  <LabelPicker taskId={task.id} taskLabels={task.labels ?? []} />
</div>

{/* Due date */}
<span className="text-muted-foreground">Due date</span>
<div>
  <input
    type="date"
    value={task.due_date ?? ''}
    onChange={(e) => {
      const val = e.target.value || null
      saveField({ due_date: val } as any)
    }}
    className="h-7 rounded border-0 bg-transparent px-1 text-sm shadow-none focus:ring-0"
  />
</div>
```

Between the description `<Separator>` and the Comments section, add:

```tsx
<SubtaskList taskId={task.id} />
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/board/TaskEditor.tsx
git commit -m "feat: integrate LabelPicker, due date input, SubtaskList into TaskEditor"
```

---

### Task 17: Frontend — LabelManager (board-level)

**Files:**
- Create: `frontend/src/components/board/LabelManager.tsx`
- Modify: `frontend/src/pages/BoardPage.tsx`

- [ ] **Step 1: Create LabelManager popover**

```tsx
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import { Tag, Pencil, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

export function LabelManager() {
  const { currentBoard, labels, createLabel, updateLabel, deleteLabel } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  if (!currentBoard) return null

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await createLabel(currentBoard.id, newName.trim(), newColor)
      setNewName('')
      addNotification('Label created')
    } catch {
      addNotification('Failed to create label')
    }
  }

  const handleUpdate = async (id: string) => {
    try {
      await updateLabel(currentBoard.id, id, { name: editName, color: editColor })
      setEditingId(null)
    } catch {
      addNotification('Failed to update label')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteLabel(currentBoard.id, id)
      addNotification('Label deleted')
    } catch {
      addNotification('Failed to delete label')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <Tag className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <h3 className="mb-2 text-sm font-medium">Board Labels</h3>
        <div className="flex flex-col gap-1">
          {labels.map((label) => (
            <div key={label.id} className="group flex items-center gap-2 rounded px-1 py-1">
              {editingId === label.id ? (
                <div className="flex flex-1 flex-col gap-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(label.id) }}
                    className="h-7 text-sm"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn('size-4 rounded-full border-2', editColor === c ? 'border-foreground' : 'border-transparent')}
                        style={{ backgroundColor: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => handleUpdate(label.id)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="size-3 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="flex-1 text-sm">{label.name}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    onClick={() => { setEditingId(label.id); setEditName(label.name); setEditColor(label.color) }}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(label.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1 border-t pt-2">
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="New label..."
                className="h-7 flex-1 text-sm"
              />
              <Button size="sm" className="h-7" onClick={handleCreate} disabled={!newName.trim()}>
                <Plus className="size-3.5" />
              </Button>
            </div>
            <div className="flex gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn('size-4 rounded-full border-2', newColor === c ? 'border-foreground' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Wire LabelManager into BoardPage header**

In `BoardPage.tsx`, import `LabelManager` and add it next to the existing header buttons (share, activity, etc.):

```tsx
import { LabelManager } from '@/components/board/LabelManager'
```

Place `<LabelManager />` in the board header toolbar area.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/LabelManager.tsx frontend/src/pages/BoardPage.tsx
git commit -m "feat: LabelManager popover in board header for CRUD labels"
```

---

### Task 18: Build verification

- [ ] **Step 1: Run backend tests**

Run: `cargo test`
Expected: All pass.

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Builds without errors.

- [ ] **Step 3: Run full app**

Run: `make dev` (or `cargo run` + `cd frontend && npm run dev`)
Expected: App starts, new features visible.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build issues from lot 1 integration"
```
