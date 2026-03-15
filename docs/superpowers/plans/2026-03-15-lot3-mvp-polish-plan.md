# Lot 3 — MVP Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add command palette, archive (tasks + columns), WIP limits UI, and file attachments to bring Kanwise to feature parity with modern kanban tools.

**Architecture:** Migration v6 adds `archived` columns and `attachments` table. Archive filters at SQL level across all queries. File attachments stored on filesystem, referenced inline in Tiptap editor via Image and custom FileBlock nodes. Command palette built on existing shadcn cmdk primitives.

**Tech Stack:** Rust/Axum backend, React 19 + Tiptap + shadcn/ui + cmdk frontend, SQLite database.

**Spec:** `docs/superpowers/specs/2026-03-15-lot3-mvp-polish-design.md`

---

## Chunk 1: Backend — Migration, Models, Archive

### Task 1: Migration v6 — archive columns + attachments table

**Files:**
- Modify: `crates/server/src/db/migrations.rs:45-49` (add v6 call)

- [ ] **Step 1: Add v6 migration function and call**

After line 47 (`v5(conn).context("applying migration v5")?;`), add:

```rust
if current < 6 {
    v6(conn).context("applying migration v6")?;
}
```

Add new function after the v5 function:

```rust
fn v6(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction().context("begin v6 transaction")?;
    tx.execute_batch(
        "
        -- Archive support
        ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE columns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

        -- Attachments
        CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            storage_key TEXT NOT NULL,
            uploaded_by TEXT REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_attachments_task ON attachments(task_id);
        CREATE INDEX idx_attachments_board ON attachments(board_id);

        INSERT INTO schema_version (version) VALUES (6);
        ",
    )?;
    tx.commit().context("commit v6")?;
    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/tiene/Projets/kanwise && cargo check`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/migrations.rs
git commit -m "feat: add v6 migration — archive columns + attachments table"
```

---

### Task 2: Update models — archived fields + Attachment struct

**Files:**
- Modify: `crates/server/src/db/models.rs:160-168` (Column), `170-183` (Task), `303-309` (TaskWithRelations)

- [ ] **Step 1: Add `archived` to Column struct**

In `models.rs`, Column struct (line 160-168), add after `color`:

```rust
pub archived: bool,
```

- [ ] **Step 2: Add `archived` to Task struct**

In Task struct (line 170-183), add after `updated_at`:

```rust
pub archived: bool,
```

- [ ] **Step 3: Add `attachment_count` to TaskWithRelations**

In TaskWithRelations (line 303-309), add after `subtask_count`:

```rust
pub attachment_count: i32,
```

- [ ] **Step 4: Add Attachment struct**

After TaskWithRelations, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub board_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
    pub uploaded_by: Option<String>,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 5: Verify compilation**

Run: `cargo check`
Expected: compilation errors in repo.rs (archived field not populated) — that's expected, we fix in Task 3.

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/db/models.rs
git commit -m "feat: add Attachment model, archived fields to Task/Column"
```

---

### Task 3: Repo — archive methods + update existing queries

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Update all Task row-reading code to include `archived`**

**`map_task_row` (repo.rs:410-425):** Update SQL in ALL queries that use this function to include `archived` as column 11, and update the function:

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
        archived: row.get::<_, i64>(11)? != 0,
    })
}
```

Update ALL SQL SELECT queries that feed into `map_task_row` to include `archived`:
- `get_task_inner` (repo.rs:428): `SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived FROM tasks WHERE id = ?1`
- `list_tasks` (repo.rs:312): same column list + `archived`
- `create_task` (repo.rs:290): Add `archived: false` to the returned Task struct literal

**Column row-reading (repo.rs:192-200):** Update all Column construction sites to include `archived` as column 6:

In `list_columns` (repo.rs:186-208), update the SQL to:
```sql
SELECT id, board_id, name, position, wip_limit, color, archived
FROM columns WHERE board_id = ?1 AND archived = 0 ORDER BY position
```
And add `archived: row.get::<_, i64>(6)? != 0` to the Column struct.

Similarly update `create_column` (repo.rs:175): add `archived: false` to the returned Column struct literal.

- [ ] **Step 2: Update `list_tasks` to exclude archived by default**

In the `list_tasks` method, change the SQL WHERE clause from:
```sql
WHERE board_id = ?1
```
to:
```sql
WHERE board_id = ?1 AND archived = 0
```

- [ ] **Step 3: Update `list_columns` to exclude archived by default**

Same pattern — add `AND archived = 0` to the list_columns query.

- [ ] **Step 4: Update TaskWithRelations construction to include `attachment_count`**

In `tasks.rs:77-84` (the list handler), the `TaskWithRelations` is constructed. Add batch loading for attachment counts and pass `attachment_count` to the struct. Add a new repo method:

```rust
pub fn get_attachment_counts_for_board(&self, board_id: &str) -> anyhow::Result<Vec<(String, i32)>> {
    self.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT task_id, COUNT(*) as cnt FROM attachments
             WHERE board_id = ?1
             GROUP BY task_id"
        )?;
        let rows = stmt.query_map(rusqlite::params![board_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    })
}
```

- [ ] **Step 5: Add archive/unarchive methods**

```rust
pub fn archive_task(&self, task_id: &str) -> anyhow::Result<bool> {
    self.with_conn(|conn| {
        let updated = conn.execute(
            "UPDATE tasks SET archived = 1, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![task_id, now_iso()],
        )?;
        Ok(updated > 0)
    })
}

pub fn unarchive_task(&self, task_id: &str) -> anyhow::Result<bool> {
    self.with_conn(|conn| {
        // If the task's column is archived, move it to the first active column
        let col_archived: bool = conn.query_row(
            "SELECT c.archived FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.id = ?1",
            rusqlite::params![task_id],
            |row| Ok(row.get::<_, i64>(0)? != 0),
        ).unwrap_or(false);

        if col_archived {
            let board_id: String = conn.query_row(
                "SELECT board_id FROM tasks WHERE id = ?1",
                rusqlite::params![task_id],
                |row| row.get(0),
            )?;
            let first_col: Option<String> = conn.query_row(
                "SELECT id FROM columns WHERE board_id = ?1 AND archived = 0 ORDER BY position ASC LIMIT 1",
                rusqlite::params![board_id],
                |row| row.get(0),
            ).ok();
            if let Some(col_id) = first_col {
                conn.execute(
                    "UPDATE tasks SET column_id = ?2 WHERE id = ?1",
                    rusqlite::params![task_id, col_id],
                )?;
            }
        }

        let updated = conn.execute(
            "UPDATE tasks SET archived = 0, updated_at = ?2 WHERE id = ?1",
            rusqlite::params![task_id, now_iso()],
        )?;
        Ok(updated > 0)
    })
}

pub fn archive_column(&self, column_id: &str) -> anyhow::Result<i64> {
    self.with_conn(|conn| {
        let now = now_iso();
        conn.execute(
            "UPDATE columns SET archived = 1 WHERE id = ?1",
            rusqlite::params![column_id],
        )?;
        let task_count = conn.execute(
            "UPDATE tasks SET archived = 1, updated_at = ?2 WHERE column_id = ?1",
            rusqlite::params![column_id, now],
        )?;
        Ok(task_count as i64)
    })
}

pub fn unarchive_column(&self, column_id: &str) -> anyhow::Result<i64> {
    self.with_conn(|conn| {
        let now = now_iso();
        conn.execute(
            "UPDATE columns SET archived = 0 WHERE id = ?1",
            rusqlite::params![column_id],
        )?;
        let task_count = conn.execute(
            "UPDATE tasks SET archived = 0, updated_at = ?2 WHERE column_id = ?1",
            rusqlite::params![column_id, now],
        )?;
        Ok(task_count as i64)
    })
}

pub fn list_archived(&self, board_id: &str) -> anyhow::Result<(Vec<Task>, Vec<Column>)> {
    self.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board_id, column_id, title, description, priority, assignee, due_date, position, created_at, updated_at, archived
             FROM tasks WHERE board_id = ?1 AND archived = 1 ORDER BY updated_at DESC"
        )?;
        let rows = stmt.query_map(params![board_id], map_task_row)?;
        let tasks = collect_rows(rows)?;

        let mut cstmt = conn.prepare(
            "SELECT id, board_id, name, position, wip_limit, color, archived
             FROM columns WHERE board_id = ?1 AND archived = 1 ORDER BY position"
        )?;
        let crows = cstmt.query_map(params![board_id], |row| {
            Ok(Column {
                id: row.get(0)?,
                board_id: row.get(1)?,
                name: row.get(2)?,
                position: row.get(3)?,
                wip_limit: row.get(4)?,
                color: row.get(5)?,
                archived: row.get::<_, i64>(6)? != 0,
            })
        })?;
        let mut columns = Vec::new();
        for r in crows { columns.push(r?); }

        Ok((tasks, columns))
    })
}
```

- [ ] **Step 6: Add attachment CRUD methods**

```rust
pub fn create_attachment(&self, id: &str, task_id: &str, board_id: &str,
    filename: &str, mime_type: &str, size_bytes: i64, storage_key: &str,
    uploaded_by: Option<&str>) -> anyhow::Result<Attachment> {
    self.with_conn(|conn| {
        conn.execute(
            "INSERT INTO attachments (id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by],
        )?;
        let att = conn.query_row(
            "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
             FROM attachments WHERE id = ?1",
            params![id],
            |row| Ok(Attachment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                board_id: row.get(2)?,
                filename: row.get(3)?,
                mime_type: row.get(4)?,
                size_bytes: row.get(5)?,
                storage_key: row.get(6)?,
                uploaded_by: row.get(7)?,
                created_at: parse_dt(&row.get::<_, String>(8)?)?,
            }),
        )?;
        Ok(att)
    })
}

pub fn list_attachments(&self, task_id: &str) -> anyhow::Result<Vec<Attachment>> {
    self.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
             FROM attachments WHERE task_id = ?1 ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                board_id: row.get(2)?,
                filename: row.get(3)?,
                mime_type: row.get(4)?,
                size_bytes: row.get(5)?,
                storage_key: row.get(6)?,
                uploaded_by: row.get(7)?,
                created_at: parse_dt(&row.get::<_, String>(8)?)?,
            })
        })?;
        let mut result = Vec::new();
        for r in rows { result.push(r?); }
        Ok(result)
    })
}

pub fn get_attachment(&self, attachment_id: &str) -> anyhow::Result<Option<Attachment>> {
    self.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, board_id, filename, mime_type, size_bytes, storage_key, uploaded_by, created_at
             FROM attachments WHERE id = ?1"
        )?;
        let mut rows = stmt.query_map(params![attachment_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                board_id: row.get(2)?,
                filename: row.get(3)?,
                mime_type: row.get(4)?,
                size_bytes: row.get(5)?,
                storage_key: row.get(6)?,
                uploaded_by: row.get(7)?,
                created_at: parse_dt(&row.get::<_, String>(8)?)?,
            })
        })?;
        match rows.next() {
            Some(r) => Ok(Some(r?)),
            None => Ok(None),
        }
    })
}

pub fn delete_attachment(&self, attachment_id: &str) -> anyhow::Result<bool> {
    self.with_conn(|conn| {
        let affected = conn.execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![attachment_id],
        )?;
        Ok(affected > 0)
    })
}
```

- [ ] **Step 7: Add `archived` field to SearchResult model**

In `models.rs`, add to `SearchResult` struct (after `rank: f64`):
```rust
pub archived: bool,
```

In `repo.rs` where `SearchResult` is constructed (around line 1428), add column and update the SQL query to include a subquery for the archived flag:
```sql
SELECT entity_type, entity_id, board_id, task_id, snippet(search_index, 4, '<b>', '</b>', '...', 32) as snippet, rank,
       COALESCE((SELECT archived FROM tasks WHERE id = task_id), 0) as archived
FROM search_index WHERE search_index MATCH ?1 AND board_id = ?2
```
And add to the struct literal: `archived: row.get::<_, i64>(6)? != 0,`

- [ ] **Step 8: Update `search_board` to support `include_archived` param**

Change signature from `search_board(&self, board_id: &str, query: &str, limit: i64)` to `search_board(&self, board_id: &str, query: &str, limit: i64, include_archived: bool)`.

When `include_archived` is false, add to the FTS5 query:
```sql
AND task_id IN (SELECT id FROM tasks WHERE archived = 0)
```

- [ ] **Step 9: Verify compilation**

Run: `cargo check`

- [ ] **Step 10: Commit**

```bash
git add crates/server/src/db/repo.rs crates/server/src/db/models.rs
git commit -m "feat: add archive/unarchive repo methods, attachment CRUD, archived filters"
```

---

### Task 4: API — archive endpoints

**Files:**
- Create: `crates/server/src/api/archive.rs`
- Modify: `crates/server/src/api/mod.rs:1-16` (add module), `71-79` (add routes)

- [ ] **Step 1: Create `archive.rs` with handlers**

Create `crates/server/src/api/archive.rs`:

```rust
use axum::{Json, extract::{Path, State}};
use crate::db::Db;
use crate::db::models::{Column, Role, Task};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

pub async fn archive_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    db.archive_task(&tid)?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "task_archived",
        Some(&serde_json::json!({"task_title": &existing.title}).to_string()));
    Ok(Json(serde_json::json!({ "archived": true })))
}

pub async fn unarchive_task(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let existing = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if existing.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }
    db.unarchive_task(&tid)?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "task_unarchived",
        Some(&serde_json::json!({"task_title": &existing.title}).to_string()));
    Ok(Json(serde_json::json!({ "unarchived": true })))
}

pub async fn archive_column(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    // Verify column belongs to this board
    let columns = db.list_columns(&board_id)?;
    if !columns.iter().any(|c| c.id == cid) {
        return Err(ApiError::NotFound("column not found".into()));
    }
    let task_count = db.archive_column(&cid)?;
    let _ = db.log_activity(&board_id, None, &user.id, "column_archived",
        Some(&serde_json::json!({"column_id": &cid, "task_count": task_count}).to_string()));
    Ok(Json(serde_json::json!({ "archived": true, "task_count": task_count })))
}

pub async fn unarchive_column(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, cid)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    // Note: list_columns excludes archived by default — use a direct query or list_archived
    let (_, archived_cols) = db.list_archived(&board_id)?;
    if !archived_cols.iter().any(|c| c.id == cid) {
        return Err(ApiError::NotFound("archived column not found".into()));
    }
    let task_count = db.unarchive_column(&cid)?;
    let _ = db.log_activity(&board_id, None, &user.id, "column_unarchived",
        Some(&serde_json::json!({"column_id": &cid, "task_count": task_count}).to_string()));
    Ok(Json(serde_json::json!({ "unarchived": true, "task_count": task_count })))
}

pub async fn list_archived(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let (tasks, columns) = db.list_archived(&board_id)?;
    Ok(Json(serde_json::json!({ "tasks": tasks, "columns": columns })))
}
```

- [ ] **Step 2: Register module and routes in mod.rs**

In `mod.rs` line 1-16, add: `pub mod archive;`

In `mod.rs`, add archive routes to `task_item` (after line 54):
```rust
.route("/archive", post(archive::archive_task))
.route("/unarchive", post(archive::unarchive_task))
```

Add column archive routes to `columns` (after line 38):
```rust
.route("/{cid}/archive", post(archive::archive_column))
.route("/{cid}/unarchive", post(archive::unarchive_column))
```

Add archive list to `per_board` (after line 75):
```rust
.route("/archive", get(archive::list_archived))
```

- [ ] **Step 3: Update search.rs to accept `include_archived` param**

In `search.rs`, update `SearchParams` struct (line 13-17):
```rust
pub struct SearchParams {
    pub q: String,
    pub limit: Option<i64>,
    pub include_archived: Option<bool>,
}
```

Update the handler call (line 31):
```rust
let results = db.search_board(&board_id, q, limit, params.include_archived.unwrap_or(false))?;
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check`

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/api/archive.rs crates/server/src/api/mod.rs crates/server/src/api/search.rs
git commit -m "feat: add archive API endpoints and search include_archived param"
```

---

### Task 5: API — attachments endpoints

**Files:**
- Create: `crates/server/src/api/attachments.rs`
- Modify: `crates/server/src/api/mod.rs` (routes)
- Modify: `Cargo.toml` (workspace, add multipart feature to axum)

- [ ] **Step 1: Enable axum multipart feature**

In root `Cargo.toml`, change the axum dependency:
```toml
axum = { version = "0.8", features = ["ws", "multipart"] }
```

- [ ] **Step 2: Create `attachments.rs`**

Create `crates/server/src/api/attachments.rs`:

```rust
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use std::path::PathBuf;
use crate::db::Db;
use crate::db::models::{Attachment, Role};
use super::error::ApiError;
use super::middleware::AuthUser;
use super::permissions;

fn uploads_dir() -> PathBuf {
    PathBuf::from(std::env::var("KANBAN_UPLOADS_DIR").unwrap_or_else(|_| "./uploads".into()))
}

fn max_upload_size() -> u64 {
    std::env::var("KANBAN_MAX_UPLOAD_SIZE")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10 * 1024 * 1024) // 10MB default
}

pub async fn upload(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
    mut multipart: Multipart,
) -> Result<Json<Attachment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let task = db.get_task(&tid)?.ok_or_else(|| ApiError::NotFound("task not found".into()))?;
    if task.board_id != board_id { return Err(ApiError::NotFound("task not found".into())); }

    let field = multipart.next_field().await
        .map_err(|e| ApiError::BadRequest(format!("multipart error: {e}")))?
        .ok_or_else(|| ApiError::BadRequest("no file field".into()))?;

    let filename = field.file_name().unwrap_or("unnamed").to_string();
    let mime_type = field.content_type().unwrap_or("application/octet-stream").to_string();
    let data = field.bytes().await
        .map_err(|e| ApiError::BadRequest(format!("read error: {e}")))?;

    if data.len() as u64 > max_upload_size() {
        return Err(ApiError::BadRequest(format!("file too large (max {}MB)", max_upload_size() / 1024 / 1024)));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let storage_key = format!("{}/{}/{}_{}", board_id, tid, id, filename);
    let full_path = uploads_dir().join(&storage_key);

    // Create directories
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent).await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("mkdir error: {e}")))?;
    }

    tokio::fs::write(&full_path, &data).await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("write error: {e}")))?;

    let attachment = db.create_attachment(
        &id, &tid, &board_id, &filename, &mime_type,
        data.len() as i64, &storage_key, Some(&user.id),
    )?;

    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "attachment_added",
        Some(&serde_json::json!({
            "task_title": &task.title,
            "filename": &filename,
            "size_bytes": data.len(),
        }).to_string()));

    Ok(Json(attachment))
}

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid)): Path<(String, String)>,
) -> Result<Json<Vec<Attachment>>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let attachments = db.list_attachments(&tid)?;
    Ok(Json(attachments))
}

pub async fn download(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, aid)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Viewer)?;
    let att = db.get_attachment(&aid)?
        .ok_or_else(|| ApiError::NotFound("attachment not found".into()))?;
    if att.board_id != board_id { return Err(ApiError::NotFound("attachment not found".into())); }

    let path = uploads_dir().join(&att.storage_key);
    let data = tokio::fs::read(&path).await
        .map_err(|_| ApiError::NotFound("file not found on disk".into()))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &att.mime_type)
        .header(header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", att.filename))
        .body(Body::from(data))
        .unwrap())
}

pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, aid)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member)?;
    let att = db.get_attachment(&aid)?
        .ok_or_else(|| ApiError::NotFound("attachment not found".into()))?;
    if att.board_id != board_id { return Err(ApiError::NotFound("attachment not found".into())); }

    let task = db.get_task(&tid)?;
    db.delete_attachment(&aid)?;

    // Try to delete file from disk (non-fatal if missing)
    let path = uploads_dir().join(&att.storage_key);
    let _ = tokio::fs::remove_file(&path).await;

    if let Some(task) = task {
        let _ = db.log_activity(&board_id, Some(&tid), &user.id, "attachment_deleted",
            Some(&serde_json::json!({"task_title": &task.title, "filename": &att.filename}).to_string()));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
```

- [ ] **Step 3: Register module and routes in mod.rs**

Add `pub mod attachments;` to module declarations.

Add attachment routes — in `task_item` (after subtasks nest):
```rust
.route("/attachments", get(attachments::list).post(attachments::upload))
.route("/attachments/{aid}", axum::routing::delete(attachments::delete))
```

Add download route to `per_board` (after archive):
```rust
.route("/attachments/{aid}/download", get(attachments::download))
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check`

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/server/src/api/attachments.rs crates/server/src/api/mod.rs
git commit -m "feat: add file attachment upload, download, list, delete endpoints"
```

---

### Task 6: Update task list handler to include attachment_count

**Files:**
- Modify: `crates/server/src/api/tasks.rs:53-87`

- [ ] **Step 1: Add attachment count batch loading**

In `tasks.rs` list handler, after the subtask_counts loading (line 71-75), add:

```rust
let attachment_counts = db.get_attachment_counts_for_board(&board_id)?;
let mut att_counts_by_task: HashMap<String, i32> = HashMap::new();
for (task_id, count) in attachment_counts {
    att_counts_by_task.insert(task_id, count);
}
```

Update the TaskWithRelations construction (line 77-84):

```rust
let result: Vec<TaskWithRelations> = tasks
    .into_iter()
    .map(|task| {
        let labels = labels_by_task.remove(&task.id).unwrap_or_default();
        let subtask_count = counts_by_task.remove(&task.id).unwrap_or(SubtaskCount { completed: 0, total: 0 });
        let attachment_count = att_counts_by_task.remove(&task.id).unwrap_or(0);
        TaskWithRelations { task, labels, subtask_count, attachment_count }
    })
    .collect();
```

Also update the `get` handler (line 115-134) to include attachment_count:

```rust
let attachment_count = db.list_attachments(&tid)?.len() as i32;
Ok(Json(TaskWithRelations { task, labels, subtask_count, attachment_count }))
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/api/tasks.rs
git commit -m "feat: include attachment_count in task list/detail responses"
```

---

### Task 7: MCP — archive actions + archived filter + board_ask update

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`
- Modify: `crates/server/src/mcp/board_ask.rs`
- Modify: `crates/server/src/mcp/kbf_bridge.rs`

- [ ] **Step 1: Add `include_archived` to BoardQueryParams**

In `tools.rs`, add to `BoardQueryParams`:
```rust
pub include_archived: Option<bool>,
```

- [ ] **Step 2: Add archive/unarchive actions to board_mutate match**

Add before the fallback `other =>` arm:

```rust
"archive_task" => { /* call db.archive_task, log activity */ }
"unarchive_task" => { /* call db.unarchive_task, log activity */ }
"archive_column" => { /* call db.archive_column, log activity */ }
"unarchive_column" => { /* call db.unarchive_column, log activity */ }
"delete_attachment" => { /* call db.delete_attachment */ }
```

- [ ] **Step 3: Add attachments scope to board_query**

Add `"attachments"` scope that requires `task_id` and returns attachment list.

- [ ] **Step 4: Update board_ask queries to exclude archived**

In `board_ask.rs`, add `AND t.archived = 0` (or `AND archived = 0` depending on alias) to every SQL query in: `query_overdue`, `query_due_range`, `query_unassigned`, `query_no_labels`, `query_stale`, `query_stats`, `query_high_priority`, `query_no_due_date`.

Add new keyword pattern:
```rust
} else if matches_pattern(&q, &["archived", "archives", "archivé"]) {
    self.query_archived(board_id, format)
```

- [ ] **Step 5: Add attachment KBF encoding to kbf_bridge.rs**

Add `attachment_schema()` function following the pattern of `label_schema()`.

- [ ] **Step 6: Update MCP stdio tool inputSchema in main.rs**

Add `"include_archived"` to `board_query` inputSchema properties. Add `"archive_task"`, `"unarchive_task"`, `"archive_column"`, `"unarchive_column"`, `"delete_attachment"` to `board_mutate` action enum.

- [ ] **Step 7: Verify full backend compiles and runs**

Run: `cargo build`

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/mcp/tools.rs crates/server/src/mcp/board_ask.rs crates/server/src/mcp/kbf_bridge.rs crates/server/src/main.rs
git commit -m "feat: add archive/attachment MCP actions, archived filter, board_ask update"
```

---

## Chunk 2: Frontend — Command Palette, WIP Limits UI, Archive UI

### Task 8: Command palette + keyboard shortcuts

**Files:**
- Create: `frontend/src/components/CommandPalette.tsx`
- Create: `frontend/src/components/ShortcutsDialog.tsx`
- Create: `frontend/src/hooks/useHotkeys.ts`
- Modify: `frontend/src/pages/BoardPage.tsx`

- [ ] **Step 1: Create `useHotkeys.ts`**

Create `frontend/src/hooks/useHotkeys.ts`:

```typescript
import { useEffect } from 'react'

interface HotkeyAction {
  key: string
  ctrl?: boolean
  meta?: boolean
  handler: () => void
  allowInInput?: boolean
}

export function useHotkeys(actions: HotkeyAction[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      for (const action of actions) {
        const metaMatch = action.meta ? (e.metaKey || e.ctrlKey) : true
        const ctrlMatch = action.ctrl ? e.ctrlKey : true

        if (e.key.toLowerCase() === action.key.toLowerCase() && metaMatch && ctrlMatch) {
          if (isInput && !action.allowInInput) continue
          e.preventDefault()
          action.handler()
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [actions])
}
```

- [ ] **Step 2: Create `ShortcutsDialog.tsx`**

Create `frontend/src/components/ShortcutsDialog.tsx` — a simple Dialog listing all shortcuts in a grid (shortcut key + description). Use existing shadcn Dialog primitives.

- [ ] **Step 3: Create `CommandPalette.tsx`**

Create `frontend/src/components/CommandPalette.tsx` using existing `components/ui/command.tsx` primitives:

```typescript
import { useState } from 'react'
import {
  CommandDialog, Command, CommandInput, CommandList,
  CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command'
import { Plus, Search, Kanban, List, GanttChart, Activity, Keyboard } from 'lucide-react'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: string) => void
}

export function CommandPalette({ open, onOpenChange, onAction }: CommandPaletteProps) {
  function run(action: string) {
    onAction(action)
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder="Type a command..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Tasks">
            <CommandItem onSelect={() => run('create-task')}>
              <Plus className="size-4" />
              Create task
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => run('search')}>
              <Search className="size-4" />
              Search
              <CommandShortcut>/</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Views">
            <CommandItem onSelect={() => run('view-kanban')}>
              <Kanban className="size-4" /> Kanban view <CommandShortcut>1</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-list')}>
              <List className="size-4" /> List view <CommandShortcut>2</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('view-timeline')}>
              <GanttChart className="size-4" /> Timeline view <CommandShortcut>3</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Board">
            <CommandItem onSelect={() => run('activity')}>
              <Activity className="size-4" /> Activity <CommandShortcut>A</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run('shortcuts')}>
              <Keyboard className="size-4" /> Keyboard shortcuts <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
```

- [ ] **Step 4: Wire into BoardPage.tsx**

In `BoardPage.tsx`:
- Import `CommandPalette`, `ShortcutsDialog`, `useHotkeys`
- Add state: `const [paletteOpen, setPaletteOpen] = useState(false)`
- Add state: `const [shortcutsOpen, setShortcutsOpen] = useState(false)`
- Add `useHotkeys` call with all shortcuts mapped to callbacks
- Add `<CommandPalette>` and `<ShortcutsDialog>` components before closing `</div>`

- [ ] **Step 5: Verify frontend builds**

Run: `cd frontend && npx tsc --noEmit && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useHotkeys.ts frontend/src/components/CommandPalette.tsx frontend/src/components/ShortcutsDialog.tsx frontend/src/pages/BoardPage.tsx
git commit -m "feat: add command palette (Cmd+K) and keyboard shortcuts"
```

---

### Task 9: WIP limits UI — editable popover in column header

**Files:**
- Modify: `frontend/src/components/board/KanbanColumn.tsx`

- [ ] **Step 1: Add WIP limit edit popover**

In `KanbanColumn.tsx`, wrap the task counter `<span>` (lines 45-57) with a Popover. On click, show a small popover with a number input. Save on blur/Enter via the existing `api.updateTask` → use a direct API call or pass a callback prop.

Add imports:
```typescript
import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
```

Replace the counter `<span>` with a Popover-wrapped version:
- PopoverTrigger renders the existing counter span (clickable)
- PopoverContent shows: "WIP Limit" label + `<Input type="number">` with current value
- On blur or Enter: call `api.updateTask(boardId, column.id, { wip_limit: value || null })` — actually this is `updateColumn`, not `updateTask`. Use the column update API from the store or directly.

Note: The store doesn't expose `updateColumn`. Use `api` directly and refresh columns via `useBoardStore.getState().fetchBoard(boardId)`, or add an `updateColumn` method to the store. Simpler approach: call `api` directly since it's a one-off interaction.

```typescript
const [wipOpen, setWipOpen] = useState(false)
const [wipValue, setWipValue] = useState(column.wip_limit?.toString() ?? '')

async function saveWipLimit() {
  const val = wipValue.trim() === '' ? null : parseInt(wipValue, 10) || null
  try {
    await api.updateColumn(boardId, column.id, { wip_limit: val ? val : null })
    setWipOpen(false)
  } catch { /* ignore */ }
}
```

- [ ] **Step 2: Add `updateColumn` to api.ts if missing**

Check if `api.updateColumn` exists. If not, add:
```typescript
updateColumn: (boardId: string, columnId: string, data: { name?: string; wip_limit?: number | null; color?: string | null }) =>
  request<{ updated: boolean }>(`/boards/${boardId}/columns/${columnId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/board/KanbanColumn.tsx frontend/src/lib/api.ts
git commit -m "feat: add WIP limit edit popover in column header"
```

---

### Task 10: Frontend — archive API, store, types

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/stores/board.ts`

- [ ] **Step 1: Add `archived` to Task and Column types, add Attachment type**

In `api.ts`, add to Task interface (after `updated_at`):
```typescript
archived?: boolean
```

Add to Column interface (after `color`):
```typescript
archived?: boolean
```

Add `attachment_count` to Task interface (after `subtask_count`):
```typescript
attachment_count?: number
```

Add Attachment interface:
```typescript
export interface Attachment {
  id: string
  task_id: string
  board_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by?: string
  created_at: string
}
```

- [ ] **Step 2: Add archive + attachment API methods**

In the `api` object, add:

```typescript
// Archive
archiveTask: (boardId: string, taskId: string) =>
  request<{ archived: boolean }>(`/boards/${boardId}/tasks/${taskId}/archive`, { method: 'POST' }),
unarchiveTask: (boardId: string, taskId: string) =>
  request<{ unarchived: boolean }>(`/boards/${boardId}/tasks/${taskId}/unarchive`, { method: 'POST' }),
archiveColumn: (boardId: string, columnId: string) =>
  request<{ archived: boolean; task_count: number }>(`/boards/${boardId}/columns/${columnId}/archive`, { method: 'POST' }),
unarchiveColumn: (boardId: string, columnId: string) =>
  request<{ unarchived: boolean; task_count: number }>(`/boards/${boardId}/columns/${columnId}/unarchive`, { method: 'POST' }),
listArchived: (boardId: string) =>
  request<{ tasks: Task[]; columns: Column[] }>(`/boards/${boardId}/archive`),

// Attachments
listAttachments: (boardId: string, taskId: string) =>
  request<Attachment[]>(`/boards/${boardId}/tasks/${taskId}/attachments`),
deleteAttachment: (boardId: string, taskId: string, attachmentId: string) =>
  request<{ deleted: boolean }>(`/boards/${boardId}/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' }),
```

For file upload, add a separate function (cannot use `request<T>` since it sets Content-Type to JSON):

```typescript
uploadAttachment: async (boardId: string, taskId: string, file: File): Promise<Attachment> => {
  const token = localStorage.getItem('token')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/boards/${boardId}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
},
```

- [ ] **Step 3: Add `archived` to SearchResult type and update searchBoard**

In `api.ts`, find the `SearchResult` interface and add:
```typescript
archived?: boolean
```

Update `searchBoard`:

```typescript
searchBoard: (boardId: string, q: string, limit = 20, includeArchived = false) =>
  request<SearchResult[]>(
    `/boards/${boardId}/search?q=${encodeURIComponent(q)}&limit=${limit}${includeArchived ? '&include_archived=true' : ''}`
  ),
```

- [ ] **Step 4: Add archive store methods**

In `board.ts`, add to the interface and implementation:

```typescript
archiveTask: async (boardId: string, taskId: string) => {
  await api.archiveTask(boardId, taskId)
  set({ tasks: get().tasks.filter((t) => t.id !== taskId) })
  notify('Task archived')
},

unarchiveTask: async (boardId: string, taskId: string) => {
  await api.unarchiveTask(boardId, taskId)
  // Refresh board to get the restored task in correct position
  get().fetchBoard(boardId)
  notify('Task restored')
},

archiveColumn: async (boardId: string, columnId: string) => {
  await api.archiveColumn(boardId, columnId)
  set({
    columns: get().columns.filter((c) => c.id !== columnId),
    tasks: get().tasks.filter((t) => t.column_id !== columnId),
  })
  notify('Column archived')
},

unarchiveColumn: async (boardId: string, columnId: string) => {
  await api.unarchiveColumn(boardId, columnId)
  get().fetchBoard(boardId)
  notify('Column restored')
},
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/stores/board.ts
git commit -m "feat: add archive/attachment types, API methods, store actions"
```

---

### Task 11: Archive UI — TaskEditor, KanbanColumn, ArchivePanel, SearchBar

**Files:**
- Modify: `frontend/src/components/board/TaskEditor.tsx`
- Modify: `frontend/src/components/board/KanbanColumn.tsx`
- Create: `frontend/src/components/board/ArchivePanel.tsx`
- Modify: `frontend/src/components/board/SearchBar.tsx`
- Modify: `frontend/src/pages/BoardPage.tsx`

- [ ] **Step 1: Add Archive button to TaskEditor footer**

In `TaskEditor.tsx`, add an `handleArchive` function next to `handleDelete` (after line 197):

```typescript
const handleArchive = async () => {
  if (!currentBoard) return
  try {
    await useBoardStore.getState().archiveTask(currentBoard.id, task.id)
    onClose()
  } catch {
    addNotification('Failed to archive task')
  }
}
```

In the footer section, add an Archive button before the Delete button:
```tsx
<Button variant="ghost" size="sm" onClick={handleArchive} className="gap-1.5 text-muted-foreground">
  <Archive className="size-3.5" />
  Archive
</Button>
```

Import `Archive` from lucide-react.

- [ ] **Step 2: Add "Archive column" to KanbanColumn context menu**

In `KanbanColumn.tsx`, add a small dropdown menu (`MoreHorizontal` icon) in the column header with an "Archive column" option. Use shadcn `DropdownMenu`. On click, call `useBoardStore.getState().archiveColumn(boardId, column.id)`.

- [ ] **Step 3: Create ArchivePanel.tsx**

Create `frontend/src/components/board/ArchivePanel.tsx` — a side panel (similar to `ActivityPanel`) that:
- Fetches archived items via `api.listArchived(boardId)` on open
- Lists archived tasks and columns in two sections
- Each item has a "Restore" button calling the appropriate unarchive method
- Uses shadcn Sheet component for the panel

- [ ] **Step 4: Add "Include archives" toggle to SearchBar**

In `SearchBar.tsx`, add a small toggle button (icon: `Archive`) next to the search input. State: `includeArchived: boolean` (default false). Pass it to `api.searchBoard(boardId, q.trim(), 20, includeArchived)`.

When results come back, items with `archived === true` in the `SearchResult` show a gray "Archived" badge next to the snippet.

- [ ] **Step 5: Wire ArchivePanel into BoardPage**

In `BoardPage.tsx`:
- Import `ArchivePanel`
- Add state: `const [archiveOpen, setArchiveOpen] = useState(false)`
- Add "Archives" item in the DropdownMenu (after "Fields"):
```tsx
<DropdownMenuItem onClick={() => setArchiveOpen(true)}>
  <Archive className="size-3.5" />
  Archives
</DropdownMenuItem>
```
- Add `<ArchivePanel boardId={boardId} open={archiveOpen} onClose={() => setArchiveOpen(false)} />` before closing div

Import `Archive` from lucide-react.

- [ ] **Step 6: Verify build**

Run: `cd frontend && npx tsc --noEmit && pnpm build`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/board/TaskEditor.tsx frontend/src/components/board/KanbanColumn.tsx frontend/src/components/board/ArchivePanel.tsx frontend/src/components/board/SearchBar.tsx frontend/src/pages/BoardPage.tsx
git commit -m "feat: add archive UI — TaskEditor, column menu, ArchivePanel, search toggle"
```

---

## Chunk 3: Frontend — File Attachments (Tiptap Integration)

### Task 12: Install @tiptap/extension-image

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install dependency**

Run: `cd frontend && pnpm add @tiptap/extension-image`

- [ ] **Step 2: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: add @tiptap/extension-image dependency"
```

---

### Task 13: Create FileBlock custom Tiptap node

**Files:**
- Create: `frontend/src/components/editor/FileBlockNode.tsx`

- [ ] **Step 1: Create the custom Tiptap node extension**

Create `frontend/src/components/editor/FileBlockNode.tsx`:

```typescript
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { FileText, FileArchive, FileImage, File } from 'lucide-react'

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('zip') || mime.includes('archive')) return FileArchive
  if (mime.includes('pdf') || mime.includes('document')) return FileText
  return File
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileBlockComponent({ node }: { node: { attrs: { src: string; filename: string; mime: string; size: number } } }) {
  const Icon = getFileIcon(node.attrs.mime)
  return (
    <NodeViewWrapper className="my-2">
      <a
        href={node.attrs.src}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 no-underline transition hover:bg-muted/50"
      >
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{node.attrs.filename}</p>
          <p className="text-xs text-muted-foreground">{formatSize(node.attrs.size)}</p>
        </div>
      </a>
    </NodeViewWrapper>
  )
}

export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      filename: { default: 'file' },
      mime: { default: 'application/octet-stream' },
      size: { default: 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockComponent)
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/editor/FileBlockNode.tsx
git commit -m "feat: add FileBlock custom Tiptap node for non-image attachments"
```

---

### Task 14: Integrate file upload into TiptapEditor

**Files:**
- Modify: `frontend/src/components/editor/TiptapEditor.tsx`

- [ ] **Step 1: Add Image extension + FileBlock + drop handler**

In `TiptapEditor.tsx`:

Add imports:
```typescript
import Image from '@tiptap/extension-image'
import { Plugin } from '@tiptap/pm/state'
import { FileBlock } from './FileBlockNode'
import { api } from '@/lib/api'
```

Update the `TiptapEditorProps` interface to accept board/task context:
```typescript
interface TiptapEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  boardId?: string  // NEW — for file upload
  taskId?: string   // NEW — for file upload
}
```

Add extensions to the `useEditor` config (line 75-88):
```typescript
extensions: [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Placeholder.configure({ placeholder }),
  Image.configure({ inline: false, allowBase64: false }),
  FileBlock,
  // Drop handler plugin for file uploads
  ...(boardId && taskId ? [createFileDropPlugin(boardId, taskId)] : []),
],
```

Add the drop handler plugin factory outside the component:
```typescript
function createFileDropPlugin(boardId: string, taskId: string) {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        const files = event.dataTransfer?.files
        if (!files?.length) return false

        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos

        Array.from(files).forEach(async (file) => {
          try {
            const attachment = await api.uploadAttachment(boardId, taskId, file)
            const downloadUrl = `/api/v1/boards/${boardId}/attachments/${attachment.id}/download`

            if (file.type.startsWith('image/')) {
              view.dispatch(view.state.tr.insert(
                pos ?? view.state.doc.content.size,
                view.state.schema.nodes.image.create({ src: downloadUrl })
              ))
            } else {
              view.dispatch(view.state.tr.insert(
                pos ?? view.state.doc.content.size,
                view.state.schema.nodes.fileBlock.create({
                  src: downloadUrl,
                  filename: attachment.filename,
                  mime: attachment.mime_type,
                  size: attachment.size_bytes,
                })
              ))
            }
          } catch {
            // upload failed — silently ignore
          }
        })
        return true
      },
    },
  })
}
```

- [ ] **Step 2: Update TaskEditor.tsx to pass boardId/taskId to TiptapEditor**

In `TaskEditor.tsx`, find where `<TiptapEditor>` is used and add `boardId={currentBoard?.id}` and `taskId={task.id}` props.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/editor/TiptapEditor.tsx frontend/src/components/board/TaskEditor.tsx
git commit -m "feat: integrate file upload via drag-and-drop in Tiptap editor"
```

---

### Task 15: TaskCard — attachment count indicator

**Files:**
- Modify: `frontend/src/components/board/TaskCard.tsx`

- [ ] **Step 1: Add paperclip indicator**

In `TaskCard.tsx`, import `Paperclip` from lucide-react.

In the metadata row (line 104), add after the subtask progress block (after line 121):

```tsx
{task.attachment_count && task.attachment_count > 0 && (
  <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
    <Paperclip className="size-3" />
    {task.attachment_count}
  </div>
)}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/board/TaskCard.tsx
git commit -m "feat: show attachment count with paperclip icon on task cards"
```

---

### Task 16: Full build verification

- [ ] **Step 1: Backend build**

Run: `cd /Users/tiene/Projets/kanwise && cargo build`

- [ ] **Step 2: Frontend build**

Run: `cd frontend && pnpm build`

- [ ] **Step 3: Smoke test**

Run the dev server and verify:
- [ ] Cmd+K opens command palette with all actions
- [ ] Direct shortcuts work (n, /, 1, 2, 3, a, ?)
- [ ] Click task counter in column header → WIP limit popover
- [ ] Archive button in task editor footer
- [ ] Archive column option in column dropdown
- [ ] Archives item in board overflow menu → panel opens
- [ ] Drag file into task description → uploads and inserts
- [ ] Images display inline, other files as styled blocks
- [ ] Attachment count shown on task cards
- [ ] Search "include archives" toggle works

- [ ] **Step 4: Fix any issues, commit**

```bash
git add -A
git commit -m "fix: address smoke test issues for Lot 3"
```
