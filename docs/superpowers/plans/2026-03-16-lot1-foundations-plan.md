# Lot 1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate database access to async `tokio-rusqlite`, add background cleanup tasks, and configure WebSocket reconnect.

**Architecture:** Replace `Arc<Mutex<Connection>>` with `tokio_rusqlite::Connection` in `Db`. This cascades `.await` across ~270 call sites in ~25 files. Add `tokio::spawn` background tasks for session/rate-limit cleanup. Configure `y-websocket`'s built-in reconnect and add a `ConnectionStatus` UI component.

**Tech Stack:** Rust (tokio-rusqlite, axum, tokio), React 19 (y-websocket, Zustand), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-16-lot1-foundations-design.md`

---

## Chunk 1: Database Layer Migration

The async migration must be done atomically across the db layer — `mod.rs`, `repo.rs`, and `migrations.rs` — since they are tightly coupled. The codebase will not compile until all callers are updated (Chunk 2-3), which is expected.

### Task 1: Add `tokio-rusqlite` dependency

**Files:**
- Modify: `Cargo.toml` (workspace root, dependencies section)
- Modify: `crates/server/Cargo.toml`

- [ ] **Step 1: Add `tokio-rusqlite` to workspace dependencies**

In the root `Cargo.toml`, add to `[workspace.dependencies]`:
```toml
tokio-rusqlite = "0.6"
```

- [ ] **Step 2: Add `tokio-rusqlite` to server crate**

In `crates/server/Cargo.toml`, add:
```toml
tokio-rusqlite.workspace = true
```

- [ ] **Step 3: Verify dependency resolves**

Run: `cargo check -p kanwise 2>&1 | head -20`
Expected: Dependency downloads, then compilation errors from existing code (not dependency resolution errors).

### Task 2: Rewrite `db/mod.rs`

**Files:**
- Modify: `crates/server/src/db/mod.rs`

The `Db` struct changes from `Arc<Mutex<Connection>>` to `tokio_rusqlite::Connection`. Both `new` and `in_memory` become async. `with_conn` becomes async with `&Connection` closure signature.

**Critical: `tokio-rusqlite` error type handling.** The `call()` method expects closures returning `Result<R, tokio_rusqlite::Error>`, but our closures return `anyhow::Result<T>`. We use a double-Result pattern: the closure always returns `Ok(f(conn))` to `tokio-rusqlite`, wrapping our `anyhow::Result<T>` inside the success path. The outer `?` handles connection errors, the inner `?` handles application errors.

- [ ] **Step 1: Rewrite `db/mod.rs`**

Replace the entire file contents with:

```rust
pub mod migrations;
pub mod models;
pub mod repo;

/// Thread-safe async wrapper around a SQLite connection.
///
/// Uses `tokio_rusqlite` to dispatch all database operations to a dedicated
/// background thread, preventing blocking of the Tokio runtime.
#[derive(Clone)]
pub struct Db {
    conn: tokio_rusqlite::Connection,
}

impl Db {
    /// Open (or create) a database at the given file path, set pragmas, and
    /// run migrations.
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open(path).await?;
        // Set pragmas and run migrations on the connection thread.
        // Double-Result: inner anyhow::Result wrapped in Ok() for tokio_rusqlite.
        conn.call(|conn| {
            Ok((|| -> anyhow::Result<()> {
                conn.pragma_update(None, "journal_mode", "WAL")?;
                conn.pragma_update(None, "busy_timeout", 5000)?;
                conn.pragma_update(None, "foreign_keys", "ON")?;
                migrations::run_migrations(conn)?;
                Ok(())
            })())
        })
        .await
        .map_err(|e| anyhow::anyhow!("db init: {e}"))??;
        Ok(Self { conn })
    }

    /// Create an in-memory database (useful for tests).
    #[allow(dead_code)]
    pub async fn in_memory() -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open_in_memory().await?;
        conn.call(|conn| {
            Ok((|| -> anyhow::Result<()> {
                conn.pragma_update(None, "foreign_keys", "ON")?;
                migrations::run_migrations(conn)?;
                Ok(())
            })())
        })
        .await
        .map_err(|e| anyhow::anyhow!("db init: {e}"))??;
        Ok(Self { conn })
    }

    /// Execute a closure with access to the underlying connection.
    ///
    /// The closure runs on a dedicated background thread so it never blocks
    /// the Tokio runtime. Uses double-Result pattern to pass anyhow errors
    /// through tokio_rusqlite's error boundary.
    pub async fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&rusqlite::Connection) -> anyhow::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        self.conn
            .call(move |conn| Ok(f(conn)))
            .await
            .map_err(|e| anyhow::anyhow!("db connection: {e}"))?
    }
}
```

**Note on `??` and `?`:** In `Db::new` and `in_memory`, the `??` at the end unpacks two layers: the outer `tokio_rusqlite::Error` (connection failure) and the inner `anyhow::Error` (pragma/migration failure). In `with_conn`, there's only one `?` because the return type is already `anyhow::Result<T>` — the inner `anyhow::Result<T>` is returned directly.

- [ ] **Step 2: Verify the file compiles in isolation**

Run: `cargo check -p kanwise 2>&1 | grep "db/mod.rs" | head -5`
Expected: No errors from `db/mod.rs` itself (errors from callers are expected).

### Task 3: Migrate `db/repo.rs` — make all methods async

**Files:**
- Modify: `crates/server/src/db/repo.rs`

Every public method calls `self.with_conn(...)`. Since `with_conn` is now async, every method gains `async` and `.await`. The closure signature stays `&Connection` (immutable reference), same as before — `tokio-rusqlite` provides `&Connection`.

- [ ] **Step 1: Make all `impl Db` methods async**

For every public method in `repo.rs` that calls `self.with_conn(|conn| { ... })`:
1. Add `async` to the function signature
2. Add `.await` after the `with_conn(...)` call
3. Closure parameter stays `|conn|` — no change needed, same `&Connection` type

Example transformation:
```rust
// Before
pub fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
    self.with_conn(|conn| {
        // ...
    })
}

// After
pub async fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
    self.with_conn(|conn| {
        // ...
    }).await
}
```

Apply this transformation to ALL ~69 public methods. The inner closure bodies remain identical.

**Important**: Some methods capture `&str` parameters in the closure. These closures now need `'static` lifetime. Convert `&str` params to owned `String` before the closure:

```rust
// Before
pub fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
    self.with_conn(|conn| {
        // uses name, description directly
    })
}

// After
pub async fn create_board(&self, name: &str, description: Option<&str>) -> anyhow::Result<Board> {
    let name = name.to_string();
    let description = description.map(|s| s.to_string());
    self.with_conn(move |conn| {
        // uses name, description as owned Strings
    }).await
}
```

This pattern applies to ALL methods that take `&str` parameters. The closure must own all captured data (`move` keyword, `.to_string()` conversions).

For methods that take `&[u8]` (like `save_crdt_state`), convert to `Vec<u8>` with `.to_vec()`.

- [ ] **Step 2: Fix helper functions**

The private helper functions (`get_board_inner`, `get_task_inner`, `map_task_row`, `collect_rows`, `sanitize_snippet`) take `&Connection` directly — they are called inside closures, not through `with_conn`. They do NOT need to become async. However, their signature changes from `&Connection` to `&rusqlite::Connection` (already correct).

- [ ] **Step 3: Fix test functions**

All `#[test]` functions that use `Db::in_memory()` become `#[tokio::test]` with `async`:

```rust
// Before
#[test]
fn test_something() {
    let db = Db::in_memory().unwrap();
    db.some_method().unwrap();
}

// After
#[tokio::test]
async fn test_something() {
    let db = Db::in_memory().await.unwrap();
    db.some_method().await.unwrap();
}
```

### Task 4: Update `db/migrations.rs`

**Files:**
- Modify: `crates/server/src/db/migrations.rs`

- [ ] **Step 1: Remove pragmas from `run_migrations`**

Both `journal_mode = WAL` and `foreign_keys = ON` are now set in `Db::new()`. Remove them from `run_migrations` (lines 7-9 of `migrations.rs`). The `run_migrations` function itself stays sync — it runs inside a `call()` closure on the connection thread.

- [ ] **Step 2: Verify migrations still take `&Connection`**

`run_migrations` and all `vN` functions take `&Connection`. This is correct — they run inside the sync closure in `Db::new()`. No changes needed to their signatures.

- [ ] **Step 3: Commit the database layer**

```bash
git add crates/server/Cargo.toml Cargo.toml crates/server/src/db/
git commit -m "refactor: migrate db layer to tokio-rusqlite

Db::new, Db::in_memory, and with_conn are now async.
All repo methods are async with owned closure captures.
Pragmas consolidated in Db::new (WAL, busy_timeout, foreign_keys).

NOTE: Does not compile yet — callers updated in next commits."
```

---

## Chunk 2: Backend Caller Migration

Mechanical `.await` propagation across all files that call `Db` methods or `auth::` functions. Each task fixes one module. The codebase compiles after ALL tasks in this chunk are complete.

### Task 5: Migrate `auth/mod.rs`

**Files:**
- Modify: `crates/server/src/auth/mod.rs`

Functions `create_session`, `validate_session`, `create_invite_link`, `accept_invite` call `db.with_conn()` or `db.` methods. They become async. The standalone functions `generate_token`, `hash_token`, `generate_api_key`, `hash_password`, `verify_password` are pure computation — no DB calls, stay sync.

- [ ] **Step 1: Make DB-calling functions async**

For each of these functions:
- `create_session(db, user_id)` → `async fn`, add `.await` on `db.with_conn(...)`
- `validate_session(db, token)` → `async fn`, add `.await` on `db.with_conn(...)`
- `cleanup_expired_sessions(db)` → Keep for now (will be moved to `Db` method and removed in Task 14)
- `create_invite_link(db, ...)` → `async fn`, add `.await` on `db.with_conn(...)`
- `accept_invite(db, ...)` → `async fn`, add `.await` on `db.with_conn(...)`

Same `&str` → `String` ownership pattern as repo.rs for closure captures.

- [ ] **Step 2: Remove probabilistic cleanup from `validate_session`**

In `validate_session`, remove the block:
```rust
// Probabilistic cleanup (~1 in 256 calls)
if rand::random::<u8>() == 0 {
    cleanup_expired_sessions(db).ok();
}
```

- [ ] **Step 3: Fix test functions**

Convert `#[test]` to `#[tokio::test] async` for tests that use DB-calling auth functions.

### Task 6: Migrate `api/middleware.rs`

**Files:**
- Modify: `crates/server/src/api/middleware.rs`

- [ ] **Step 1: Add `.await` to auth calls**

In `auth_middleware`:
- `db.validate_api_key(&key_hash)?` → `db.validate_api_key(&key_hash).await?`
- `auth::validate_session(&db, token)` → `auth::validate_session(&db, token).await`

The function is already `async fn`, so this compiles.

### Task 7: Migrate all `api/*.rs` handler modules

**Files:**
- Modify: `crates/server/src/api/boards.rs`
- Modify: `crates/server/src/api/tasks.rs`
- Modify: `crates/server/src/api/columns.rs`
- Modify: `crates/server/src/api/labels.rs`
- Modify: `crates/server/src/api/subtasks.rs`
- Modify: `crates/server/src/api/comments.rs`
- Modify: `crates/server/src/api/custom_fields.rs`
- Modify: `crates/server/src/api/archive.rs`
- Modify: `crates/server/src/api/attachments.rs`
- Modify: `crates/server/src/api/search.rs`
- Modify: `crates/server/src/api/activity.rs`
- Modify: `crates/server/src/api/permissions.rs`
- Modify: `crates/server/src/api/api_keys.rs`
- Modify: `crates/server/src/api/auth.rs`

All handlers are already `async fn`. The only change is adding `.await` after every `db.method()` call and every `auth::function()` call.

- [ ] **Step 1: Add `.await` to all `db.` calls in each module**

Pattern: `db.method(args)?` → `db.method(args).await?`

Apply to all 14 modules. Each module has 2-15 handler functions with 1-5 db calls each.

For `api/auth.rs` specifically, also add `.await` to:
- `auth::create_session(&db, &user.id)?` → `auth::create_session(&db, &user.id).await?`
- `auth::verify_password(...)?` stays sync (no DB call)
- `auth::create_invite_link(&db, ...)` → `.await`
- `auth::accept_invite(&db, ...)` → `.await`

- [ ] **Step 2: Fix `api/permissions.rs`**

`require_role` calls `db.get_board_member()` — add `.await`. If `require_role` is sync, make it async.

### Task 8: Migrate `mcp/tools.rs`

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`

The `KanbanMcpServer` methods (`handle_query`, `handle_mutate`, `handle_sync`, `handle_ask`) are sync and call ~70 `self.db.method()` calls. They must become async.

- [ ] **Step 1: Make all handler methods async**

```rust
// Before
pub fn handle_query(&self, params: BoardQueryParams) -> Result<String> {

// After
pub async fn handle_query(&self, params: BoardQueryParams) -> Result<String> {
```

Apply to: `handle_query`, `handle_mutate`, `handle_sync`, `handle_ask`, and all private methods that call `self.db.*` (`query_boards_list`, `query_kbf`, `query_json`, `apply_deltas`, `apply_field_update`, `apply_create`).

- [ ] **Step 2: Add `.await` to all `self.db.` calls**

Pattern: `self.db.method(args)?` → `self.db.method(args).await?`

~70 call sites. Mechanical transformation.

- [ ] **Step 3: Fix the REST API wrapper functions**

The `pub async fn query(...)`, `mutate(...)`, `sync(...)`, `ask(...)` functions at the bottom of the file already are async. They call `server.handle_query(qp)` — add `.await`:

```rust
// Before
let result = server.handle_query(qp);

// After
let result = server.handle_query(qp).await;
```

### Task 9: Migrate `mcp/board_ask.rs`

**Files:**
- Modify: `crates/server/src/mcp/board_ask.rs`

- [ ] **Step 1: Make methods async and add `.await`**

`AskEngine` methods call `self.db.with_conn()` (7 times) and `self.db.method()` (4 times). Make all methods that do DB calls async and add `.await`.

Methods to make async: `answer`, `query_overdue`, `query_due_range`, `query_unassigned`, `query_no_labels`, `query_stale`, `query_high_priority`, `query_no_due_date`, `query_archived`, `query_stats`, `search_fallback`, `format_tasks`.

### Task 10: Migrate `mcp/sse.rs`

**Files:**
- Modify: `crates/server/src/mcp/sse.rs`

- [ ] **Step 1: Add `.await` to handler calls in `call_tool`**

In `McpSseHandler::call_tool` (already async), the calls to `server.handle_query()`, `server.handle_mutate()`, `server.handle_sync()`, `server.handle_ask()` need `.await`.

### Task 11: Migrate `sync/doc.rs` and `sync/ws.rs`

**Files:**
- Modify: `crates/server/src/sync/doc.rs`
- Modify: `crates/server/src/sync/ws.rs`

- [ ] **Step 1: Fix `sync/doc.rs`**

`init_from_db` is already async. Add `.await` to the DB calls inside it:
- `db.load_crdt_state(board_id)?` → `db.load_crdt_state(board_id).await?`
- `db.list_columns(board_id)?` → `db.list_columns(board_id).await?`
- `db.list_tasks(board_id, i64::MAX, 0)?` → `db.list_tasks(board_id, i64::MAX, 0).await?`

Fix test functions: `#[tokio::test] async` and add `.await` on all db calls.

- [ ] **Step 2: Fix `sync/ws.rs`**

In `ws_handler` (already async), add `.await`:
- `state.db.validate_api_key(&key_hash)` → `.await`
- `auth::validate_session(&state.db, &token)` → `.await`
- `state.db.get_board_member(&board_id, &u.id)` → `.await`

In `handle_socket` (already async), add `.await`:
- `state.db.save_crdt_state(&board_id, &state_bytes)` → `.await` (2 occurrences)

Fix test functions similarly.

### Task 12: Migrate `main.rs`

**Files:**
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Make `Db::new` calls async in all paths**

In `run_http_server` (already async):
```rust
// Before
let db = db::Db::new(&db_path)?;

// After
let db = db::Db::new(&db_path).await?;
```

- [ ] **Step 2: Make `reset_password` async**

```rust
// Before
fn reset_password(email: &str) -> anyhow::Result<()> {

// After
async fn reset_password(email: &str) -> anyhow::Result<()> {
```

Add `.await` to `Db::new`, `db.get_user_by_email`, `db.set_password_hash`, `db.delete_user_sessions`.

Update the call in `main()`:
```rust
// Before
reset_password(email)

// After
reset_password(email).await
```

- [ ] **Step 3: Restructure `run_mcp_stdio` for async**

The current blocking `for line in stdin.lock().lines()` loop cannot call `.await`. Replace with `tokio::io::AsyncBufReadExt`:

```rust
async fn run_mcp_stdio() -> anyhow::Result<()> {
    eprintln!("WARNING: MCP stdio mode has no authentication...");

    let db_path = std::env::var("DATABASE_PATH")
        .unwrap_or_else(|_| "kanwise.db".to_string());
    let db = db::Db::new(&db_path).await?;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut lines = stdin.lines();

    let server = mcp::KanbanMcpServer::new(db);

    while let Some(line) = lines.next_line().await? {
        if line.is_empty() {
            continue;
        }
        // ... rest of the logic stays the same,
        // but server.handle_query(qp) becomes server.handle_query(qp).await
        // and stdout.write_all / stdout.flush become .await
    }
    Ok(())
}
```

Key changes:
- `std::io::stdin()` → `tokio::io::stdin()` with `BufReader`
- `for line in stdin.lock().lines()` → `while let Some(line) = lines.next_line().await?`
- `server.handle_query(qp)` → `server.handle_query(qp).await`
- `server.handle_mutate(mp)` → `server.handle_mutate(mp).await`
- `server.handle_sync(sp)` → `server.handle_sync(sp).await`
- `server.handle_ask(ap)` → `server.handle_ask(ap).await`
- `writeln!(out, ...)` → `stdout.write_all(format!(...).as_bytes()).await?; stdout.write_all(b"\n").await?`
- `out.flush()` → `stdout.flush().await?`

- [ ] **Step 4: First compilation checkpoint**

Run: `cargo check -p kanwise 2>&1`
Expected: Clean compilation (0 errors). Fix any remaining issues.

Run: `cargo clippy -p kanwise 2>&1`
Expected: No new warnings.

- [ ] **Step 5: Run existing tests**

Run: `cargo test --workspace 2>&1`
Expected: All existing tests pass.

- [ ] **Step 6: Commit the full caller migration**

```bash
git add -A crates/server/src/
git commit -m "refactor: propagate async across all db callers

All ~270 call sites updated with .await. MCP stdio loop
restructured to use tokio::io for async compatibility.
All existing tests pass."
```

---

## Chunk 3: Background Cleanup Tasks

### Task 13: Add `RateLimiter::sweep()` method

**Files:**
- Modify: `crates/server/src/api/rate_limit.rs`

- [ ] **Step 1: Write the test for `sweep`**

Add at the bottom of `rate_limit.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_removes_stale_entries() {
        let limiter = RateLimiter::new(10, 1); // 1-second window
        // Fill with requests
        assert!(limiter.check("1.2.3.4"));
        assert!(limiter.check("5.6.7.8"));
        // Both IPs have recent timestamps, sweep should remove nothing
        assert_eq!(limiter.sweep(), 0);
        // Wait for window to expire
        std::thread::sleep(std::time::Duration::from_millis(1100));
        // Now sweep should remove both
        assert_eq!(limiter.sweep(), 2);
    }

    #[test]
    fn sweep_preserves_active_entries() {
        let limiter = RateLimiter::new(10, 60); // 60-second window
        assert!(limiter.check("active-ip"));
        assert_eq!(limiter.sweep(), 0); // should keep active IP
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p kanwise -- rate_limit::tests 2>&1`
Expected: FAIL — `sweep` method not found.

- [ ] **Step 3: Implement `sweep()`**

Add to `impl RateLimiter`:
```rust
/// Remove all stale entries: prune old timestamps, then drop empty entries.
/// Returns the number of IPs removed.
pub fn sweep(&self) -> usize {
    let mut map = self.state.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let window = std::time::Duration::from_secs(self.window_secs);

    // First pass: prune old timestamps from all entries
    for timestamps in map.values_mut() {
        timestamps.retain(|t| now.duration_since(*t) < window);
    }

    // Second pass: remove entries with no remaining timestamps
    let before = map.len();
    map.retain(|_, v| !v.is_empty());
    before - map.len()
}
```

- [ ] **Step 4: Remove probabilistic cleanup from `check()`**

In `RateLimiter::check()`, remove:
```rust
// Probabilistic cleanup of stale entries (~1 in 256 calls)
// or forced cleanup when map exceeds size limit
if rand::random::<u8>() == 0 || map.len() > MAX_TRACKED_IPS {
    map.retain(|_, v| !v.is_empty());
}
```

Also remove the `MAX_TRACKED_IPS` constant if no longer used.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test -p kanwise -- rate_limit::tests 2>&1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/api/rate_limit.rs
git commit -m "feat: add RateLimiter::sweep(), remove probabilistic cleanup"
```

### Task 14: Add `Db::cleanup_expired_sessions()` method

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Write the test**

Add to the test module in `repo.rs`:
```rust
#[tokio::test]
async fn cleanup_expired_sessions_removes_old() {
    let db = Db::in_memory().await.unwrap();
    let user = db.create_user("test", "test@test.com", None, false, Some("hash")).await.unwrap();

    // Create a session (30-day expiry)
    let token = crate::auth::generate_token();
    let token_hash = crate::auth::hash_token(&token);
    let expired = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), user.id, token_hash, expired],
        )?;
        Ok(())
    }).await.unwrap();

    let count = db.cleanup_expired_sessions().await.unwrap();
    assert_eq!(count, 1);

    // Running again should find nothing
    let count = db.cleanup_expired_sessions().await.unwrap();
    assert_eq!(count, 0);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p kanwise -- cleanup_expired_sessions 2>&1`
Expected: FAIL — method not found.

- [ ] **Step 3: Implement `cleanup_expired_sessions`**

Add to `impl Db` in `repo.rs`:
```rust
/// Delete all sessions that have expired. Returns the number of deleted rows.
pub async fn cleanup_expired_sessions(&self) -> anyhow::Result<usize> {
    let now = chrono::Utc::now().to_rfc3339();
    self.with_conn(move |conn| {
        let count = conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            rusqlite::params![now],
        )?;
        Ok(count)
    })
    .await
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p kanwise -- cleanup_expired_sessions 2>&1`
Expected: PASS.

- [ ] **Step 5: Remove old `cleanup_expired_sessions` from `auth/mod.rs`**

Delete the `pub fn cleanup_expired_sessions(db: &Db)` function from `auth/mod.rs` and remove the call to it in `validate_session` (the probabilistic cleanup was already removed in Task 5, but the function definition remains — remove it now).

- [ ] **Step 6: Commit**

```bash
git add crates/server/src/db/repo.rs crates/server/src/auth/mod.rs
git commit -m "feat: add Db::cleanup_expired_sessions(), remove old auth version"
```

### Task 15: Add `spawn_cleanup_tasks` to `main.rs`

**Files:**
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Add the `spawn_cleanup_tasks` function**

Add before `run_http_server`:
```rust
use std::time::Duration;

fn spawn_cleanup_tasks(db: db::Db, rate_limiter: api::rate_limit::RateLimiter) {
    let db_clone = db.clone();
    // Session cleanup — every hour
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match db_clone.cleanup_expired_sessions().await {
                Ok(count) if count > 0 => {
                    tracing::info!("Purged {count} expired sessions");
                }
                Err(e) => {
                    tracing::warn!("Session cleanup failed: {e}");
                }
                _ => {}
            }
        }
    });

    // Rate limiter sweep — every 5 minutes
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            let removed = rate_limiter.sweep();
            if removed > 0 {
                tracing::debug!("Rate limiter: removed {removed} stale IPs");
            }
        }
    });
}
```

- [ ] **Step 2: Wire it into `run_http_server`**

In `run_http_server`, the `RateLimiter` is created inside `api::router()`. To access it, either:
1. Create the `RateLimiter` in `run_http_server` and pass it to `api::router`, or
2. Return the `RateLimiter` from `api::router`.

Option 1 is cleaner. Modify `api/mod.rs` to accept the rate limiter:

```rust
// In api/mod.rs, change router signature:
pub fn router(db: Db, rate_limiter: RateLimiter) -> Router {
    // Use the passed-in rate_limiter instead of creating one
}
```

Then in `run_http_server`:
```rust
let rate_limiter = api::rate_limit::RateLimiter::new(10, 60);
spawn_cleanup_tasks(db.clone(), rate_limiter.clone());
let app = api::router(db, rate_limiter)
    .nest("/ws", ws_routes)
    // ...
```

- [ ] **Step 3: Verify compilation and run tests**

Run: `cargo check -p kanwise && cargo test --workspace 2>&1`
Expected: Clean compilation, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/main.rs crates/server/src/api/mod.rs
git commit -m "feat: add background cleanup tasks for sessions and rate limiter

Sessions purged every hour, rate limiter swept every 5 minutes.
Replaces probabilistic cleanup with deterministic intervals."
```

---

## Chunk 4: Frontend — WebSocket Reconnect & Connection Status

### Task 16: Configure `y-websocket` reconnect

**Files:**
- Modify: `frontend/src/lib/sync.ts`

- [ ] **Step 1: Add `maxBackoffTime` to WebsocketProvider**

```typescript
// Before
const provider = new WebsocketProvider(`${wsBase}/ws/boards`, boardId, doc, {
    params: { token },
})

// After
const provider = new WebsocketProvider(`${wsBase}/ws/boards`, boardId, doc, {
    params: { token },
    maxBackoffTime: 30000,
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/sync.ts
git commit -m "feat: configure y-websocket reconnect with 30s max backoff"
```

### Task 17: Expose connection status from `useSync`

**Files:**
- Modify: `frontend/src/hooks/useSync.ts`

- [ ] **Step 1: Change `connected: boolean` to `status` enum**

Replace the `SyncState` interface and update the hook:

```typescript
import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { createSyncProvider } from '@/lib/sync'
import { useAuthStore } from '@/stores/auth'

type SyncStatus = 'connected' | 'connecting' | 'disconnected'

interface SyncState {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  status: SyncStatus
}

export function useSync(boardId: string | null): SyncState {
  const [status, setStatus] = useState<SyncStatus>('disconnected')
  const providerRef = useRef<WebsocketProvider | null>(null)
  const docRef = useRef<Y.Doc | null>(null)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!boardId) return

    const { doc, provider } = createSyncProvider(boardId, token)
    docRef.current = doc
    providerRef.current = provider

    if (!provider) {
      return () => {
        doc.destroy()
        docRef.current = null
      }
    }

    const onStatus = ({ status: s }: { status: string }) => {
      setStatus(s as SyncStatus)
    }

    provider.on('status', onStatus)

    return () => {
      provider.off('status', onStatus)
      provider.destroy()
      doc.destroy()
      docRef.current = null
      providerRef.current = null
      setStatus('disconnected')
    }
  }, [boardId, token])

  return {
    doc: docRef.current,
    provider: providerRef.current,
    status,
  }
}
```

- [ ] **Step 2: Update consumers of `useSync`**

In `frontend/src/pages/BoardPage.tsx`, the current usage is:
```typescript
const { provider } = useSync(boardId)
```
This still works — `provider` is unchanged. No update needed since `connected` was not used here.

Search for any other usage of `connected` from `useSync` across the codebase and update to `status === 'connected'`.

### Task 18: Build `ConnectionStatus` component

**Files:**
- Create: `frontend/src/components/board/ConnectionStatus.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { SyncStatus } from '@/hooks/useSync'

interface ConnectionStatusProps {
  status: SyncStatus
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  if (status === 'connected') return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg glass glass-border px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
      <span
        className={`size-2 rounded-full ${
          status === 'connecting'
            ? 'animate-pulse bg-yellow-500'
            : 'bg-red-500'
        }`}
      />
      {status === 'connecting' ? 'Reconnecting...' : 'Offline'}
    </div>
  )
}
```

- [ ] **Step 2: Export `SyncStatus` type from `useSync.ts`**

Add export to the type:
```typescript
export type SyncStatus = 'connected' | 'connecting' | 'disconnected'
```

### Task 19: Wire `ConnectionStatus` into `BoardPage`

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx`

**Note:** The spec suggests `AppLayout`, but `ConnectionStatus` belongs in `BoardPage` because sync only exists on board pages. Placing it in `AppLayout` would show a disconnected indicator on pages without WebSocket connections (dashboard, login).

- [ ] **Step 1: Add ConnectionStatus to BoardPage**

The `ConnectionStatus` should render when a board is active. Add it in `BoardPage`:

```typescript
// Add import
import { ConnectionStatus } from '@/components/board/ConnectionStatus'

// Update useSync destructuring
const { provider, status } = useSync(boardId)

// Add at the end of the return JSX, before closing </div>:
<ConnectionStatus status={status} />
```

- [ ] **Step 2: Run frontend dev server and verify**

Run: `cd frontend && pnpm dev`
Navigate to a board. Verify no visible indicator when connected. Kill the backend — verify "Reconnecting..." appears. Restart backend — verify indicator disappears.

- [ ] **Step 3: Commit frontend changes**

```bash
git add frontend/src/
git commit -m "feat: add connection status indicator with y-websocket reconnect

Configures 30s max backoff on WebsocketProvider.
Exposes status (connected/connecting/disconnected) from useSync.
Shows subtle indicator when disconnected/reconnecting."
```

---

## Chunk 5: Verification & Final Tests

### Task 20: Add concurrent read test

**Files:**
- Modify: `crates/server/src/db/repo.rs` (test module)

- [ ] **Step 1: Write the concurrent read test**

```rust
#[tokio::test]
async fn concurrent_reads() {
    let db = Db::in_memory().await.unwrap();
    let board = db.create_board("Concurrent", None).await.unwrap();

    // Spawn 10 concurrent reads
    let mut handles = vec![];
    for _ in 0..10 {
        let db = db.clone();
        let board_id = board.id.clone();
        handles.push(tokio::spawn(async move {
            db.get_board(&board_id).await.unwrap()
        }));
    }

    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result.is_some());
    }
}
```

- [ ] **Step 2: Run and verify**

Run: `cargo test -p kanwise -- concurrent_reads 2>&1`
Expected: PASS.

### Task 21: Full test suite verification

- [ ] **Step 1: Run all backend tests**

Run: `cargo test --workspace 2>&1`
Expected: All tests pass. No regressions.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy --workspace 2>&1`
Expected: No new warnings.

- [ ] **Step 3: Run frontend unit tests**

Run: `cd frontend && pnpm test 2>&1`
Expected: All tests pass.

- [ ] **Step 4: Build production binary**

Run: `cd frontend && pnpm build && cd .. && cargo build --release 2>&1`
Expected: Clean build. Binary at `target/release/kanwise`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: add concurrent read test, verify full test suite

All backend tests pass with tokio-rusqlite migration.
Frontend tests pass with useSync status change.
Production binary builds cleanly."
```
