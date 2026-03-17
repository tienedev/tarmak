# Lot 2 — CLI Commands

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Self-hosted admin CLI (backup, restore, export, import, users)

## Overview

Add 5 CLI subcommands to the `kanwise` binary so self-hosted administrators can manage their instance without the web UI. Replace the current hand-rolled `std::env::args()` parsing with `clap` derive-based subcommands.

## 1. CLI Framework (`clap`)

### Problem

`main.rs` currently matches `--mcp` and `--reset-password <email>` with raw string comparisons on `std::env::args()`. Adding 5 more subcommands with flags (`--output`, `--force`, positional args) would make this unmaintainable and produce poor error messages.

### Solution

Add `clap` (v4, `derive` feature) and define a `Cli` enum with subcommands. Running `kanwise` with no subcommand defaults to the HTTP server.

### Design

```rust
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
```

**Default subcommand:** `Args` wraps `Option<Cli>`. When `kanwise` is invoked without any subcommand, `command` is `None` and the server starts — preserving the current behavior:
```rust
match args.command {
    None | Some(Cli::Serve) => run_http_server().await,
    Some(Cli::Mcp) => run_mcp_stdio().await,
    // ...
}
```

**Breaking change:** `--mcp` becomes `kanwise mcp`, `--reset-password <email>` becomes `kanwise reset-password <email>`. Acceptable for a self-hosted tool where the admin controls the invocation.

## 2. Backup

### Command

```
kanwise backup [-o <path>]
```

### Behavior

1. Resolve the database path from `DATABASE_PATH` env var (default: `kanwise.db`)
2. Open the database via `tokio_rusqlite::Connection`
3. Execute `VACUUM INTO ?1` with the output path — creates an atomic, consistent copy even while the server is running in WAL mode
4. Default output filename: `kanwise-backup-YYYYMMDD-HHMMSS.db` (local time)
5. Print the output path and file size

### Example

```
$ kanwise backup
Backup saved to kanwise-backup-20260316-143022.db (2.4 MB)

$ kanwise backup -o /backups/daily.db
Backup saved to /backups/daily.db (2.4 MB)
```

### Error cases

- Source DB does not exist → error with message
- Output path is not writable → error from SQLite
- Output file already exists → SQLite returns an error. Use `-o` to specify a different path, or delete the existing file.

## 3. Restore

### Command

```
kanwise restore <file> [--force]
```

### Behavior

1. Verify the source file exists
2. Validate it's a valid SQLite database: open it with `rusqlite`, run `PRAGMA integrity_check`
3. Warn if WAL/SHM files exist for the target DB path (indicates the server may be running)
4. Ask for confirmation: `WARNING: This will replace the current database at <path>. Continue? [y/N]`
5. Skip confirmation if `--force` is passed
6. Copy the backup file over the target DB path using `std::fs::copy`
7. Remove stale `-wal` and `-shm` files if they exist (they belong to the old DB state)
8. Print success message with file size

### Example

```
$ kanwise restore /backups/daily.db
WARNING: This will replace the current database at kanwise.db
Continue? [y/N] y
Database restored from /backups/daily.db (2.4 MB)
```

### Error cases

- Source file does not exist → error
- Source file is not a valid SQLite DB → error with integrity check details
- Target path not writable → error

## 4. Export

### Command

```
kanwise export <board_id> [-o <path>]
```

### Behavior

1. Open the database
2. Fetch the board by ID (error if not found)
3. Fetch all related data: columns, tasks (including archived), labels, subtasks, comments, custom fields, field values
4. Build a self-contained JSON document (always pretty-printed):

```json
{
  "version": 1,
  "exported_at": "2026-03-16T14:30:22Z",
  "board": {
    "id": "...",
    "name": "Sprint 12",
    "description": "...",
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-15T18:30:00Z"
  },
  "columns": [
    { "id": "...", "name": "To Do", "position": 0, "wip_limit": null, "color": null, "archived": false }
  ],
  "tasks": [
    { "id": "...", "column_id": "...", "title": "...", "description": "...", "priority": "medium", "assignee": null, "due_date": null, "position": 0, "created_at": "...", "updated_at": "...", "archived": false }
  ],
  "labels": [
    { "id": "...", "name": "Bug", "color": "#ef4444", "created_at": "..." }
  ],
  "task_labels": [
    { "task_id": "...", "label_id": "..." }
  ],
  "subtasks": [
    { "id": "...", "task_id": "...", "title": "...", "completed": false, "position": 0, "created_at": "..." }
  ],
  "comments": [
    { "id": "...", "task_id": "...", "user_id": "...", "user_name": "Alice", "content": "...", "created_at": "..." }
  ],
  "custom_fields": [
    { "id": "...", "name": "Story Points", "field_type": "number", "config": null, "position": 0 }
  ],
  "field_values": [
    { "task_id": "...", "field_id": "...", "value": "5" }
  ]
}
```

Note: `user_name` in comments is `Option<String>` (may be `null`). `board_id` is omitted from child entities since it's implicit from the parent board.

5. Write to `--output` file or stdout (default)
6. When writing to a file, print a summary to stderr

### Data included

All fields from the data models are preserved including timestamps (`created_at`, `updated_at`). Attachment metadata is **not** included — export prints a warning to stderr if the board has attachments, suggesting the user back up the uploads directory separately.

Assignee user IDs are preserved as-is. On cross-instance import, if the referenced user does not exist on the target instance, the task will appear unassigned in the UI.

### New Db methods needed

- `Db::get_all_tasks_for_board(board_id)` — returns all tasks (active + archived) without pagination. The existing `list_tasks` uses `WHERE archived = 0` and `LIMIT/OFFSET`, which is unsuitable for a full export.
- `Db::get_comments_for_board(board_id)` — joins comments with tasks to get all comments for a board in one query
- `Db::get_subtasks_for_board(board_id)` — joins subtasks with tasks for the board

**Reused existing methods:**
- `get_labels_for_board_tasks(board_id)` — returns `Vec<(String, Label)>` (task_id, label). Extract `(task_id, label.id)` pairs for the `task_labels` array.
- `get_custom_field_values_for_board(board_id)` — returns `Vec<TaskCustomFieldValue>`, matching export needs directly.
- `list_columns(board_id)`, `list_labels(board_id)`, `list_custom_fields(board_id)` — all exist.

### Example

```
$ kanwise export abc123 -o sprint12.json
Exported board "Sprint 12" (45 tasks, 3 columns, 8 labels) to sprint12.json

$ kanwise export abc123 | jq .board.name
"Sprint 12"
```

## 5. Import

### Command

```
kanwise import <file> --owner <email>
```

### Behavior

1. Read and parse the JSON file
2. Validate `version` field (must be `1`)
3. Look up the owner user by email (error if not found)
4. Build an old→new UUID mapping for all entity IDs
5. In a single DB transaction:
   a. Create the board (new ID, preserve name/description/timestamps)
   b. Add the owner as board member with `Owner` role
   c. Create columns (new IDs, map `board_id`)
   d. Create labels (new IDs, map `board_id`)
   e. Create custom fields (new IDs, map `board_id`)
   f. Create tasks (new IDs, map `board_id`, `column_id`; null out `assignee` if the user does not exist locally)
   g. Create task-label associations (map both `task_id` and `label_id`)
   h. Create subtasks (new IDs, map `task_id`)
   i. Create comments (new IDs, map `task_id`; remap `user_id` to the owner for any user_id not found locally, preserve original `user_name`)
   j. Create field values (map `task_id` and `field_id`)
6. Print summary

### ID remapping

Every entity gets a fresh `uuid::Uuid::new_v4()`. An in-memory `HashMap<String, String>` maps old IDs to new IDs. Foreign keys (`column_id` in tasks, `task_id` in subtasks, etc.) are remapped before insertion.

### Board ownership

The `--owner <email>` flag is required. The specified user is added as board `Owner` after creation. This makes the board immediately accessible via the web UI and API.

### Comment user_id handling

The `comments` table has a FK constraint: `user_id TEXT NOT NULL REFERENCES users(id)`. When importing across instances, the original `user_id` values may not exist locally. Resolution:
- For each comment, check if `user_id` exists in the local `users` table
- If not found, remap `user_id` to the `--owner` user's ID
- The original `user_name` is preserved as-is, so the display still shows who wrote the comment

### Transaction safety

All inserts happen inside a single `with_conn` call using `rusqlite::Transaction`:

```rust
db.with_conn(move |conn| {
    let tx = conn.transaction()?;
    // ... all inserts via &tx ...
    tx.commit()?;
    Ok(result)
}).await
```

If any insert fails, the entire import is rolled back — no partial data.

### Example

```
$ kanwise import sprint12.json --owner alice@example.com
Imported board "Sprint 12" (45 tasks, 3 columns, 8 labels)
Board ID: d4e5f6a7-...
```

### Error cases

- File not found → error
- Invalid JSON → error with parse details
- Unknown version → error
- Owner email not found → error with message
- Board name collision is allowed (UUIDs are unique, names can duplicate)

## 6. Users List

### Command

```
kanwise users list
```

### Behavior

1. Open the database
2. Query all users: `SELECT id, name, email, avatar_url, is_agent, created_at FROM users ORDER BY created_at`
3. Print a formatted table

### New Db method

```rust
pub async fn list_users(&self) -> anyhow::Result<Vec<User>> {
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, email, avatar_url, is_agent, created_at FROM users ORDER BY created_at"
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
    }).await
}
```

### Example

```
$ kanwise users list
ID         NAME       EMAIL              AGENT  CREATED
a1b2c3..   Alice      alice@example.com  no     2026-03-01
d4e5f6..   Bob        bob@example.com    no     2026-03-05
g7h8i9..   MCP Agent  mcp@local          yes    2026-03-10

3 users
```

## Files Modified

| File | Change |
|------|--------|
| `Cargo.toml` (workspace) | Add `clap = { version = "4", features = ["derive"] }` |
| `crates/server/Cargo.toml` | Add `clap.workspace = true` |
| `crates/server/src/main.rs` | Replace args parsing with clap `Args`/`Cli` enum, dispatch to handlers |
| `crates/server/src/cli.rs` | **New** — handler functions (`backup`, `restore`, `export_board`, `import_board`, `list_users`) + serde structs for the export JSON format (`BoardExport`, `ExportedTask`, etc.) |
| `crates/server/src/db/repo.rs` | Add `list_users()`, `get_all_tasks_for_board()`, `get_comments_for_board()`, `get_subtasks_for_board()` methods |

**Total:** 5 files changed, 1 new file. Dependencies `uuid`, `chrono`, `serde`, `serde_json` are already in the workspace.

## Out of Scope

- CSV export format (can be added later as `--format csv`)
- Trello/other tool import (future lot)
- Attachment file export/import (binary — use `tar` on the uploads directory)
- `kanwise users create/delete` (use web UI or `reset-password`)
- Hot restore while server is running (stop the server first)
- Pagination/filtering on `users list` (self-hosted instances are small)

## Success Criteria

1. `kanwise --help` shows all subcommands with descriptions
2. `kanwise backup` creates a valid SQLite copy while the server is running
3. `kanwise restore <file>` replaces the DB after confirmation
4. `kanwise export <id> | kanwise import /dev/stdin --owner <email>` round-trips a board (new IDs, same data)
5. `kanwise users list` shows all registered users
6. Running `kanwise` with no args starts the HTTP server (backward compatible)
7. All existing tests pass after the clap migration
