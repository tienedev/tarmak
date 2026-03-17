# Lot 2 — CLI Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 CLI subcommands (backup, restore, export, import, users list) to the kanwise binary using clap derive.

**Architecture:** Replace hand-rolled args parsing in `main.rs` with clap `Parser`/`Subcommand`. Add a new `cli.rs` module with handler functions and export/import serde types. Add 5 new Db methods in `repo.rs` for the queries that don't exist yet.

**Tech Stack:** Rust (clap 4 derive, serde, tokio-rusqlite, rusqlite)

**Spec:** `docs/superpowers/specs/2026-03-17-lot2-cli-commands-design.md`

---

## Chunk 1: Dependencies and clap migration

### Task 1: Add `clap` dependency

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/server/Cargo.toml`

- [ ] **Step 1: Add clap to workspace dependencies**

In the root `Cargo.toml`, add to `[workspace.dependencies]`:
```toml
clap = { version = "4", features = ["derive"] }
```

- [ ] **Step 2: Add clap to server crate**

In `crates/server/Cargo.toml`, add:
```toml
clap.workspace = true
```

- [ ] **Step 3: Verify dependency resolves**

Run: `cargo check -p kanwise 2>&1 | head -20`
Expected: Dependency downloads, no resolution errors.

### Task 2: Migrate `main.rs` to clap

**Files:**
- Modify: `crates/server/src/main.rs`

This replaces the hand-rolled `std::env::args()` parsing with clap derive. The `run_http_server`, `run_mcp_stdio`, `reset_password`, and `spawn_cleanup_tasks` functions stay unchanged.

- [ ] **Step 1: Add clap structs and rewrite `main()`**

At the top of `main.rs`, add the clap imports and structs. Then rewrite `main()` to match on the parsed subcommand. Keep all existing functions (`run_http_server`, `run_mcp_stdio`, `reset_password`, `spawn_cleanup_tasks`) as-is.

```rust
mod api;
mod auth;
mod cli;
mod db;
mod mcp;
mod static_files;
mod sync;

use std::sync::Arc;

use axum::http::{HeaderValue, Method, HeaderName};
use axum::{Router, routing::get};
use clap::{Parser, Subcommand};
use tower_http::cors::{CorsLayer, AllowOrigin};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::EnvFilter;

use sync::ws::SyncState;

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
        None | Some(Cli::Serve) => run_http_server().await,
        Some(Cli::Mcp) => run_mcp_stdio().await,
        Some(Cli::ResetPassword { email }) => reset_password(&email).await,
        Some(Cli::Backup { output }) => cli::backup(output).await,
        Some(Cli::Restore { file, force }) => cli::restore(&file, force).await,
        Some(Cli::Export { board_id, output }) => cli::export_board(&board_id, output).await,
        Some(Cli::Import { file, owner }) => cli::import_board(&file, &owner).await,
        Some(Cli::Users { command }) => match command {
            UsersCommand::List => cli::list_users().await,
        },
    }
}
```

Keep the existing `reset_password`, `spawn_cleanup_tasks`, `run_http_server`, and `run_mcp_stdio` functions unchanged below `main()`.

- [ ] **Step 2: Create stub `cli.rs` module**

Create `crates/server/src/cli.rs` with stubs so the code compiles:

```rust
use crate::db::Db;

fn db_path() -> String {
    std::env::var("DATABASE_PATH").unwrap_or_else(|_| "kanwise.db".to_string())
}

pub async fn backup(output: Option<String>) -> anyhow::Result<()> {
    todo!("backup")
}

pub async fn restore(file: &str, force: bool) -> anyhow::Result<()> {
    todo!("restore")
}

pub async fn export_board(board_id: &str, output: Option<String>) -> anyhow::Result<()> {
    todo!("export")
}

pub async fn import_board(file: &str, owner_email: &str) -> anyhow::Result<()> {
    todo!("import")
}

pub async fn list_users() -> anyhow::Result<()> {
    todo!("list_users")
}
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles (with dead_code warnings for stubs).

- [ ] **Step 4: Run existing tests**

Run: `cargo test --workspace 2>&1`
Expected: All tests pass. The clap migration doesn't affect any test.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/server/Cargo.toml crates/server/src/main.rs crates/server/src/cli.rs
git commit -m "refactor: migrate CLI to clap with subcommand stubs

Replace hand-rolled args parsing with clap derive.
Add stub cli.rs module for backup/restore/export/import/users.
Running kanwise with no subcommand still starts the HTTP server."
```

---

## Chunk 2: Backup and Restore

### Task 3: Implement `backup` command

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Implement `backup`**

Replace the `backup` stub in `cli.rs`:

```rust
pub async fn backup(output: Option<String>) -> anyhow::Result<()> {
    let db_path = db_path();
    if !std::path::Path::new(&db_path).exists() {
        anyhow::bail!("Database not found at: {db_path}");
    }

    let out_path = output.unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!("kanwise-backup-{}.db", now.format("%Y%m%d-%H%M%S"))
    });

    let db = Db::new(&db_path).await?;
    let out = out_path.clone();
    db.with_conn(move |conn| {
        conn.execute("VACUUM INTO ?1", rusqlite::params![out])?;
        Ok(())
    })
    .await?;

    let size = std::fs::metadata(&out_path)?.len();
    println!("Backup saved to {out_path} ({})", format_size(size));
    Ok(())
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles.

- [ ] **Step 3: Manual test**

Run: `cargo run -p kanwise -- backup -o /tmp/test-backup.db 2>&1`
Expected: `Backup saved to /tmp/test-backup.db (X.X KB)` (if a kanwise.db exists in the current dir, or set `DATABASE_PATH`).

Clean up: `rm /tmp/test-backup.db`

### Task 4: Implement `restore` command

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Implement `restore`**

Replace the `restore` stub in `cli.rs`:

```rust
pub async fn restore(file: &str, force: bool) -> anyhow::Result<()> {
    let source = std::path::Path::new(file);
    if !source.exists() {
        anyhow::bail!("File not found: {file}");
    }

    // Validate it's a valid SQLite database
    let conn = rusqlite::Connection::open(file)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    drop(conn);
    if integrity != "ok" {
        anyhow::bail!("File is not a valid SQLite database: {integrity}");
    }

    let db_path = db_path();

    // Warn if server might be running
    let wal_path = format!("{db_path}-wal");
    let shm_path = format!("{db_path}-shm");
    if std::path::Path::new(&wal_path).exists() || std::path::Path::new(&shm_path).exists() {
        eprintln!("WARNING: WAL/SHM files detected — the server may be running.");
        eprintln!("Stop the server before restoring to avoid corruption.");
    }

    if !force {
        eprint!("WARNING: This will replace the current database at {db_path}\nContinue? [y/N] ");
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        if !input.trim().eq_ignore_ascii_case("y") {
            println!("Aborted.");
            return Ok(());
        }
    }

    std::fs::copy(file, &db_path)?;

    // Remove stale WAL/SHM files
    let _ = std::fs::remove_file(&wal_path);
    let _ = std::fs::remove_file(&shm_path);

    let size = std::fs::metadata(&db_path)?.len();
    println!("Database restored from {file} ({})", format_size(size));
    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/cli.rs
git commit -m "feat: implement backup and restore CLI commands

backup uses VACUUM INTO for hot, atomic SQLite snapshots.
restore validates integrity, warns about running server,
asks for confirmation, and cleans up stale WAL/SHM files."
```

---

## Chunk 3: New Db methods for export

### Task 5: Add new Db methods needed by export

**Files:**
- Modify: `crates/server/src/db/repo.rs`

The export command needs data that existing methods don't return:
- `list_columns` and `list_tasks` filter out archived items — export needs everything
- No method returns all comments or subtasks for a board (only per-task)

- [ ] **Step 1: Write tests for the new methods**

Add to the test module at the bottom of `repo.rs`:

```rust
#[tokio::test]
async fn list_users_returns_all() {
    let db = test_db().await;
    db.create_user("Alice", "a@test.com", None, false, Some("hash")).await.unwrap();
    db.create_user("Bob", "b@test.com", None, true, None).await.unwrap();
    let users = db.list_users().await.unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0].name, "Alice");
    assert!(users[1].is_agent);
}

#[tokio::test]
async fn get_all_columns_for_board_includes_archived() {
    let db = test_db().await;
    let board = db.create_board("Test", None).await.unwrap();
    db.create_column(&board.id, "Active", None, None).await.unwrap();
    let col2 = db.create_column(&board.id, "Archived", None, None).await.unwrap();
    db.archive_column(&board.id, &col2.id).await.unwrap();

    // list_columns excludes archived
    let cols = db.list_columns(&board.id).await.unwrap();
    assert_eq!(cols.len(), 1);

    // get_all_columns_for_board includes archived
    let all_cols = db.get_all_columns_for_board(&board.id).await.unwrap();
    assert_eq!(all_cols.len(), 2);
}

#[tokio::test]
async fn get_all_tasks_for_board_includes_archived() {
    let db = test_db().await;
    let (board_id, _user_id, col_id) = seed(&db).await;
    let task = db.create_task(&board_id, &col_id, "Task 1", None, "medium", None, None).await.unwrap();
    db.archive_task(&task.id).await.unwrap();
    db.create_task(&board_id, &col_id, "Task 2", None, "low", None, None).await.unwrap();

    let all = db.get_all_tasks_for_board(&board_id).await.unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn get_comments_for_board_returns_all() {
    let db = test_db().await;
    let (board_id, user_id, col_id) = seed(&db).await;
    let t1 = db.create_task(&board_id, &col_id, "T1", None, "medium", None, None).await.unwrap();
    let t2 = db.create_task(&board_id, &col_id, "T2", None, "medium", None, None).await.unwrap();
    db.create_comment(&t1.id, &user_id, "Comment 1").await.unwrap();
    db.create_comment(&t2.id, &user_id, "Comment 2").await.unwrap();

    let comments = db.get_comments_for_board(&board_id).await.unwrap();
    assert_eq!(comments.len(), 2);
}

#[tokio::test]
async fn get_subtasks_for_board_returns_all() {
    let db = test_db().await;
    let (board_id, _user_id, col_id) = seed(&db).await;
    let t1 = db.create_task(&board_id, &col_id, "T1", None, "medium", None, None).await.unwrap();
    db.create_subtask(&t1.id, "Sub 1").await.unwrap();
    db.create_subtask(&t1.id, "Sub 2").await.unwrap();

    let subtasks = db.get_subtasks_for_board(&board_id).await.unwrap();
    assert_eq!(subtasks.len(), 2);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p kanwise -- list_users_returns_all get_all_columns get_all_tasks_for_board get_comments_for_board get_subtasks_for_board 2>&1`
Expected: FAIL — methods not found.

- [ ] **Step 3: Implement the new methods**

Add to `impl Db` in `repo.rs`:

```rust
/// List all registered users.
pub async fn list_users(&self) -> anyhow::Result<Vec<User>> {
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, email, avatar_url, is_agent, created_at
             FROM users ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                avatar_url: row.get(3)?,
                is_agent: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
    .await
}

/// List ALL columns for a board (including archived). Used for export.
pub async fn get_all_columns_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Column>> {
    let board_id = board_id.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board_id, name, position, wip_limit, color, archived
             FROM columns WHERE board_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![board_id], |row| {
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
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
    .await
}

/// List ALL tasks for a board (including archived, no pagination). Used for export.
pub async fn get_all_tasks_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Task>> {
    let board_id = board_id.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board_id, column_id, title, description, priority,
                    assignee, due_date, position, created_at, updated_at, archived
             FROM tasks WHERE board_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![board_id], |row| {
            Ok(Task {
                id: row.get(0)?,
                board_id: row.get(1)?,
                column_id: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                priority: Priority::from_str_db(
                    &row.get::<_, String>(5)?
                ).unwrap_or(Priority::Medium),
                assignee: row.get(6)?,
                due_date: row.get(7)?,
                position: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                archived: row.get::<_, i64>(11)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
    .await
}

/// Get all comments for all tasks in a board.
pub async fn get_comments_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Comment>> {
    let board_id = board_id.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name
             FROM comments c
             JOIN tasks t ON t.id = c.task_id
             LEFT JOIN users u ON u.id = c.user_id
             WHERE t.board_id = ?1
             ORDER BY c.created_at",
        )?;
        let rows = stmt.query_map(params![board_id], |row| {
            Ok(Comment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                user_id: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                user_name: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
    .await
}

/// Get all subtasks for all tasks in a board.
pub async fn get_subtasks_for_board(&self, board_id: &str) -> anyhow::Result<Vec<Subtask>> {
    let board_id = board_id.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT s.id, s.task_id, s.title, s.completed, s.position, s.created_at
             FROM subtasks s
             JOIN tasks t ON t.id = s.task_id
             WHERE t.board_id = ?1
             ORDER BY s.position",
        )?;
        let rows = stmt.query_map(params![board_id], |row| {
            Ok(Subtask {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                completed: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    })
    .await
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p kanwise -- list_users_returns_all get_all_columns get_all_tasks_for_board get_comments_for_board get_subtasks_for_board 2>&1`
Expected: All 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat: add Db methods for export (list_users, get_all_*, get_*_for_board)"
```

---

## Chunk 4: Export and Import

### Task 6: Implement `export` command

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Define export serde types**

Add at the top of `cli.rs`, after the existing imports:

```rust
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use crate::db::models::*;

#[derive(Serialize, Deserialize)]
pub struct BoardExport {
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub board: ExportedBoard,
    pub columns: Vec<ExportedColumn>,
    pub tasks: Vec<ExportedTask>,
    pub labels: Vec<ExportedLabel>,
    pub task_labels: Vec<TaskLabelLink>,
    pub subtasks: Vec<ExportedSubtask>,
    pub comments: Vec<ExportedComment>,
    pub custom_fields: Vec<ExportedCustomField>,
    pub field_values: Vec<ExportedFieldValue>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedBoard {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedColumn {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub wip_limit: Option<i64>,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedTask {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub assignee: Option<String>,
    pub due_date: Option<String>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct TaskLabelLink {
    pub task_id: String,
    pub label_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedSubtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub completed: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedComment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedCustomField {
    pub id: String,
    pub name: String,
    pub field_type: String,
    pub config: Option<String>,
    pub position: i64,
}

#[derive(Serialize, Deserialize)]
pub struct ExportedFieldValue {
    pub task_id: String,
    pub field_id: String,
    pub value: String,
}
```

- [ ] **Step 2: Implement `export_board`**

Replace the `export_board` stub:

```rust
pub async fn export_board(board_id: &str, output: Option<String>) -> anyhow::Result<()> {
    let db = Db::new(&db_path()).await?;

    let board = db
        .get_board(board_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Board not found: {board_id}"))?;

    let columns = db.get_all_columns_for_board(board_id).await?;
    let tasks = db.get_all_tasks_for_board(board_id).await?;
    let labels = db.list_labels(board_id).await?;
    let label_links = db.get_labels_for_board_tasks(board_id).await?;
    let subtasks = db.get_subtasks_for_board(board_id).await?;
    let comments = db.get_comments_for_board(board_id).await?;
    let custom_fields = db.list_custom_fields(board_id).await?;
    let field_values = db.get_custom_field_values_for_board(board_id).await?;

    // Check for attachments and warn
    let task_count = tasks.len();
    let has_attachments = db.with_conn({
        let board_id = board_id.to_string();
        move |conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.board_id = ?1",
                rusqlite::params![board_id],
                |row| row.get(0),
            )?;
            Ok(count > 0)
        }
    }).await?;

    if has_attachments {
        eprintln!("WARNING: Board has file attachments which are not included in the export.");
        eprintln!("Back up the uploads directory separately if needed.");
    }

    let export = BoardExport {
        version: 1,
        exported_at: Utc::now(),
        board: ExportedBoard {
            id: board.id.clone(),
            name: board.name.clone(),
            description: board.description.clone(),
            created_at: board.created_at,
            updated_at: board.updated_at,
        },
        columns: columns.into_iter().map(|c| ExportedColumn {
            id: c.id, name: c.name, position: c.position,
            wip_limit: c.wip_limit, color: c.color, archived: c.archived,
        }).collect(),
        tasks: tasks.into_iter().map(|t| ExportedTask {
            id: t.id, column_id: t.column_id, title: t.title,
            description: t.description, priority: t.priority.as_str().to_string(),
            assignee: t.assignee, due_date: t.due_date, position: t.position,
            created_at: t.created_at, updated_at: t.updated_at, archived: t.archived,
        }).collect(),
        labels: labels.into_iter().map(|l| ExportedLabel {
            id: l.id, name: l.name, color: l.color, created_at: l.created_at,
        }).collect(),
        task_labels: label_links.into_iter().map(|(task_id, label)| TaskLabelLink {
            task_id, label_id: label.id,
        }).collect(),
        subtasks: subtasks.into_iter().map(|s| ExportedSubtask {
            id: s.id, task_id: s.task_id, title: s.title,
            completed: s.completed, position: s.position, created_at: s.created_at,
        }).collect(),
        comments: comments.into_iter().map(|c| ExportedComment {
            id: c.id, task_id: c.task_id, user_id: c.user_id,
            user_name: c.user_name, content: c.content, created_at: c.created_at,
        }).collect(),
        custom_fields: custom_fields.into_iter().map(|f| ExportedCustomField {
            id: f.id, name: f.name, field_type: f.field_type.as_str().to_string(),
            config: f.config, position: f.position,
        }).collect(),
        field_values: field_values.into_iter().map(|v| ExportedFieldValue {
            task_id: v.task_id, field_id: v.field_id, value: v.value,
        }).collect(),
    };

    let json = serde_json::to_string_pretty(&export)?;

    match output {
        Some(path) => {
            std::fs::write(&path, &json)?;
            let col_count = export.columns.len();
            let label_count = export.labels.len();
            eprintln!(
                "Exported board {:?} ({task_count} tasks, {col_count} columns, {label_count} labels) to {path}",
                board.name
            );
        }
        None => {
            println!("{json}");
        }
    }

    Ok(())
}
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/cli.rs
git commit -m "feat: implement export CLI command

Exports a board and all related data to pretty-printed JSON.
Includes columns, tasks, labels, subtasks, comments, custom fields.
Warns about attachments not being included."
```

### Task 7: Implement `import` command

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Implement `import_board`**

Replace the `import_board` stub. This is the most complex handler — it reads JSON, remaps all IDs, handles FK constraints on comments, and runs everything in a single transaction.

```rust
pub async fn import_board(file: &str, owner_email: &str) -> anyhow::Result<()> {
    let content = std::fs::read_to_string(file)
        .map_err(|e| anyhow::anyhow!("Cannot read {file}: {e}"))?;
    let export: BoardExport = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("Invalid JSON: {e}"))?;

    if export.version != 1 {
        anyhow::bail!("Unsupported export version: {}", export.version);
    }

    let db = Db::new(&db_path()).await?;

    // Look up owner
    let owner = db
        .get_user_by_email(owner_email)
        .await?
        .ok_or_else(|| anyhow::anyhow!("No user found with email: {owner_email}"))?;

    // Collect all local user IDs for FK validation on comments
    let local_users = db.list_users().await?;
    let local_user_ids: std::collections::HashSet<String> =
        local_users.into_iter().map(|u| u.id).collect();

    let owner_id = owner.id.clone();
    let board_name = export.board.name.clone();

    // Run entire import in a single transaction
    let (new_board_id, task_count, col_count, label_count) = db
        .with_conn(move |conn| {
            let tx = conn.transaction()?;

            // Build ID remapping
            let mut id_map = std::collections::HashMap::<String, String>::new();
            let mut remap = |old: &str| -> String {
                id_map
                    .entry(old.to_string())
                    .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                    .clone()
            };

            // Board
            let new_board_id = remap(&export.board.id);
            tx.execute(
                "INSERT INTO boards (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    new_board_id,
                    export.board.name,
                    export.board.description,
                    export.board.created_at.to_rfc3339(),
                    export.board.updated_at.to_rfc3339(),
                ],
            )?;

            // Board member (owner)
            tx.execute(
                "INSERT INTO board_members (board_id, user_id, role) VALUES (?1, ?2, ?3)",
                rusqlite::params![new_board_id, owner_id, "owner"],
            )?;

            // Columns
            let col_count = export.columns.len();
            for col in &export.columns {
                let new_id = remap(&col.id);
                tx.execute(
                    "INSERT INTO columns (id, board_id, name, position, wip_limit, color, archived)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        new_id, new_board_id, col.name, col.position,
                        col.wip_limit, col.color, col.archived as i64,
                    ],
                )?;
            }

            // Labels
            let label_count = export.labels.len();
            for label in &export.labels {
                let new_id = remap(&label.id);
                tx.execute(
                    "INSERT INTO labels (id, board_id, name, color, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![
                        new_id, new_board_id, label.name, label.color,
                        label.created_at.to_rfc3339(),
                    ],
                )?;
            }

            // Custom fields
            for field in &export.custom_fields {
                let new_id = remap(&field.id);
                tx.execute(
                    "INSERT INTO custom_fields (id, board_id, name, field_type, config, position)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        new_id, new_board_id, field.name, field.field_type,
                        field.config, field.position,
                    ],
                )?;
            }

            // Tasks
            let task_count = export.tasks.len();
            for task in &export.tasks {
                let new_id = remap(&task.id);
                let new_col_id = id_map.get(&task.column_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown column_id: {}", task.column_id))?
                    .clone();
                // Null out assignee if user doesn't exist locally
                let assignee = task.assignee.as_ref()
                    .filter(|a| local_user_ids.contains(a.as_str()))
                    .cloned();
                tx.execute(
                    "INSERT INTO tasks (id, board_id, column_id, title, description, priority,
                                       assignee, due_date, position, created_at, updated_at, archived)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        new_id, new_board_id, new_col_id, task.title, task.description,
                        task.priority, assignee, task.due_date, task.position,
                        task.created_at.to_rfc3339(), task.updated_at.to_rfc3339(),
                        task.archived as i64,
                    ],
                )?;
            }

            // Task-label associations
            for link in &export.task_labels {
                let new_task_id = id_map.get(&link.task_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown task_id in task_labels: {}", link.task_id))?;
                let new_label_id = id_map.get(&link.label_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown label_id in task_labels: {}", link.label_id))?;
                tx.execute(
                    "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
                    rusqlite::params![new_task_id, new_label_id],
                )?;
            }

            // Subtasks
            for sub in &export.subtasks {
                let new_id = remap(&sub.id);
                let new_task_id = id_map.get(&sub.task_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown task_id in subtasks: {}", sub.task_id))?;
                tx.execute(
                    "INSERT INTO subtasks (id, task_id, title, completed, position, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        new_id, new_task_id, sub.title, sub.completed,
                        sub.position, sub.created_at.to_rfc3339(),
                    ],
                )?;
            }

            // Comments — remap user_id to owner if not found locally, preserve user_name
            for comment in &export.comments {
                let new_id = remap(&comment.id);
                let new_task_id = id_map.get(&comment.task_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown task_id in comments: {}", comment.task_id))?;
                let effective_user_id = if local_user_ids.contains(&comment.user_id) {
                    &comment.user_id
                } else {
                    &owner_id
                };
                tx.execute(
                    "INSERT INTO comments (id, task_id, user_id, content, created_at, user_name)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        new_id, new_task_id, effective_user_id,
                        comment.content, comment.created_at.to_rfc3339(),
                        comment.user_name,
                    ],
                )?;
            }

            // Field values
            for fv in &export.field_values {
                let new_task_id = id_map.get(&fv.task_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown task_id in field_values: {}", fv.task_id))?;
                let new_field_id = id_map.get(&fv.field_id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown field_id in field_values: {}", fv.field_id))?;
                tx.execute(
                    "INSERT INTO task_custom_field_values (task_id, field_id, value)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![new_task_id, new_field_id, fv.value],
                )?;
            }

            tx.commit()?;
            Ok((new_board_id, task_count, col_count, label_count))
        })
        .await?;

    println!(
        "Imported board {:?} ({task_count} tasks, {col_count} columns, {label_count} labels)",
        board_name
    );
    println!("Board ID: {new_board_id}");

    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/cli.rs
git commit -m "feat: implement import CLI command

Imports a board from Kanwise JSON export with full ID remapping.
Runs all inserts in a single transaction for atomicity.
Remaps comment user_ids to owner for cross-instance imports.
Requires --owner flag to set board ownership."
```

---

## Chunk 5: Users List and Verification

### Task 8: Implement `list_users` command

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Implement `list_users`**

Replace the `list_users` stub:

```rust
pub async fn list_users() -> anyhow::Result<()> {
    let db = Db::new(&db_path()).await?;
    let users = db.list_users().await?;

    if users.is_empty() {
        println!("No users found.");
        return Ok(());
    }

    // Print header
    println!(
        "{:<10} {:<16} {:<30} {:<7} {}",
        "ID", "NAME", "EMAIL", "AGENT", "CREATED"
    );

    for user in &users {
        let id_short = if user.id.len() > 8 {
            format!("{}..", &user.id[..8])
        } else {
            user.id.clone()
        };
        let agent = if user.is_agent { "yes" } else { "no" };
        let created = user.created_at.format("%Y-%m-%d");
        println!(
            "{:<10} {:<16} {:<30} {:<7} {}",
            id_short, user.name, user.email, agent, created
        );
    }

    println!("\n{} users", users.len());
    Ok(())
}
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check -p kanwise 2>&1`
Expected: Compiles with no errors.

### Task 9: Write export/import round-trip test

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Add test module to `cli.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn export_import_roundtrip() {
        // Create a DB with a board, columns, tasks, labels, subtasks, comments
        let db = Db::in_memory().await.unwrap();
        let board = db.create_board("Roundtrip Test", Some("desc")).await.unwrap();
        let user = db
            .create_user("Test User", "test@test.com", None, false, Some("hash"))
            .await
            .unwrap();
        db.add_board_member(&board.id, &user.id, crate::db::models::Role::Owner)
            .await
            .unwrap();

        let col = db
            .create_column(&board.id, "To Do", None, None)
            .await
            .unwrap();
        let task = db
            .create_task(&board.id, &col.id, "Task 1", Some("description"), "high", None, None)
            .await
            .unwrap();
        let label = db.create_label(&board.id, "Bug", "#ff0000").await.unwrap();
        db.add_task_label(&task.id, &label.id).await.unwrap();
        db.create_subtask(&task.id, "Subtask 1").await.unwrap();
        db.create_comment(&task.id, &user.id, "A comment").await.unwrap();

        // Export
        let columns = db.get_all_columns_for_board(&board.id).await.unwrap();
        let tasks = db.get_all_tasks_for_board(&board.id).await.unwrap();
        let labels_list = db.list_labels(&board.id).await.unwrap();
        let label_links = db.get_labels_for_board_tasks(&board.id).await.unwrap();
        let subtasks = db.get_subtasks_for_board(&board.id).await.unwrap();
        let comments = db.get_comments_for_board(&board.id).await.unwrap();
        let custom_fields = db.list_custom_fields(&board.id).await.unwrap();
        let field_values = db.get_custom_field_values_for_board(&board.id).await.unwrap();

        let export = BoardExport {
            version: 1,
            exported_at: chrono::Utc::now(),
            board: ExportedBoard {
                id: board.id.clone(),
                name: board.name.clone(),
                description: board.description.clone(),
                created_at: board.created_at,
                updated_at: board.updated_at,
            },
            columns: columns.into_iter().map(|c| ExportedColumn {
                id: c.id, name: c.name, position: c.position,
                wip_limit: c.wip_limit, color: c.color, archived: c.archived,
            }).collect(),
            tasks: tasks.into_iter().map(|t| ExportedTask {
                id: t.id, column_id: t.column_id, title: t.title,
                description: t.description, priority: t.priority.as_str().to_string(),
                assignee: t.assignee, due_date: t.due_date, position: t.position,
                created_at: t.created_at, updated_at: t.updated_at, archived: t.archived,
            }).collect(),
            labels: labels_list.into_iter().map(|l| ExportedLabel {
                id: l.id, name: l.name, color: l.color, created_at: l.created_at,
            }).collect(),
            task_labels: label_links.into_iter().map(|(tid, l)| TaskLabelLink {
                task_id: tid, label_id: l.id,
            }).collect(),
            subtasks: subtasks.into_iter().map(|s| ExportedSubtask {
                id: s.id, task_id: s.task_id, title: s.title,
                completed: s.completed, position: s.position, created_at: s.created_at,
            }).collect(),
            comments: comments.into_iter().map(|c| ExportedComment {
                id: c.id, task_id: c.task_id, user_id: c.user_id,
                user_name: c.user_name, content: c.content, created_at: c.created_at,
            }).collect(),
            custom_fields: custom_fields.into_iter().map(|f| ExportedCustomField {
                id: f.id, name: f.name, field_type: f.field_type.as_str().to_string(),
                config: f.config, position: f.position,
            }).collect(),
            field_values: field_values.into_iter().map(|v| ExportedFieldValue {
                task_id: v.task_id, field_id: v.field_id, value: v.value,
            }).collect(),
        };

        let json = serde_json::to_string_pretty(&export).unwrap();

        // Parse it back
        let reimported: BoardExport = serde_json::from_str(&json).unwrap();
        assert_eq!(reimported.version, 1);
        assert_eq!(reimported.board.name, "Roundtrip Test");
        assert_eq!(reimported.columns.len(), 1);
        assert_eq!(reimported.tasks.len(), 1);
        assert_eq!(reimported.tasks[0].title, "Task 1");
        assert_eq!(reimported.labels.len(), 1);
        assert_eq!(reimported.task_labels.len(), 1);
        assert_eq!(reimported.subtasks.len(), 1);
        assert_eq!(reimported.comments.len(), 1);
        assert_eq!(reimported.comments[0].content, "A comment");
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cargo test -p kanwise -- cli::tests::export_import_roundtrip 2>&1`
Expected: PASS.

### Task 10: Full verification

- [ ] **Step 1: Run all tests**

Run: `cargo test --workspace 2>&1`
Expected: All tests pass.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy -p kanwise 2>&1`
Expected: No new warnings.

- [ ] **Step 3: Verify `--help` output**

Run: `cargo run -p kanwise -- --help 2>&1`
Expected: Shows all subcommands (serve, mcp, backup, restore, export, import, users, reset-password).

Run: `cargo run -p kanwise -- backup --help 2>&1`
Expected: Shows backup flags.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/cli.rs
git commit -m "feat: implement users list command, add export/import roundtrip test

users list prints a formatted table of all registered users.
Roundtrip test verifies export JSON can be deserialized back."
```

- [ ] **Step 5: Build release binary**

Run: `cargo build --release -p kanwise 2>&1`
Expected: Clean build.
