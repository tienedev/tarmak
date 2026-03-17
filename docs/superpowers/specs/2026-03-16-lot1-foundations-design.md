# Lot 1 — Foundations

**Date**: 2026-03-16
**Status**: Draft
**Scope**: Backend robustness and client resilience

## Overview

Consolidate the technical foundation before adding features. Three independent chantiers that de-risk the codebase for everything that follows in the roadmap.

## 1. SQLite Connection Pool (`tokio-rusqlite`)

### Problem

`crates/server/src/db/mod.rs` wraps a single SQLite connection in `Arc<Mutex<Connection>>`. Every database call acquires a `std::sync::Mutex`, which **blocks the Tokio runtime thread** for the duration of the query. Under concurrent load (REST + WebSocket + MCP), this serializes all DB access and can stall the async event loop.

### Solution

Replace the manual mutex with `tokio_rusqlite::Connection`, which dispatches each operation to a dedicated background thread and exposes an async API.

### Design

**Db struct (before)**:
```rust
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}
```

**Db struct (after)**:
```rust
pub struct Db {
    conn: tokio_rusqlite::Connection,
}
```

**Key changes**:

| Method | Before | After |
|--------|--------|-------|
| `Db::new(path)` | Sync, opens `rusqlite::Connection` | Async, opens `tokio_rusqlite::Connection::open(path)` |
| `Db::in_memory()` | Sync | Async |
| `with_conn(f)` | `self.conn.lock()` then `f(&conn)` | `self.conn.call(move \|conn\| f(conn)).await` |

**Pragmas** (WAL, busy_timeout, foreign_keys) are applied inside the `open_with_flags_and_pragma` callback or an initial `call()` after opening.

**Migrations** run inside a single `call()` at startup, same as today but async.

**Closure signature change**: `tokio_rusqlite::Connection::call` passes `&mut Connection` (not `&Connection`). The `with_conn` signature changes accordingly:
```rust
// Before
pub fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
where F: FnOnce(&Connection) -> anyhow::Result<T>

// After
pub async fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
where F: FnOnce(&mut Connection) -> anyhow::Result<T> + Send + 'static, T: Send + 'static
```
This is backward-compatible (`&mut` auto-reborrows to `&`), but the `Send + 'static` bounds may require minor adjustments in closures that capture non-Send types.

**Error handling**: `tokio_rusqlite::Connection::call` returns `Result<R, tokio_rusqlite::Error<E>>`. The `with_conn` wrapper maps this to `anyhow::Error` to preserve the existing API contract:
```rust
self.conn.call(move |conn| f(conn)).await.map_err(|e| anyhow::anyhow!("{e}"))
```

**Call site migration — two levels of cascade**:

1. **Direct `with_conn` calls** (~87 sites): These gain `.await`. Concentrated in `db/repo.rs` (~69), `mcp/board_ask.rs` (~8), `auth/mod.rs` (~6), `api/auth.rs` (~4).
2. **Callers of `Db` public methods** (~180+ sites): Every public method in `repo.rs` becomes async, so all callers in `api/*.rs` (~108 calls across 14 handler modules), `mcp/tools.rs` (~64 calls), `sync/ws.rs` (~4 calls), `sync/doc.rs` (~3 calls), `api/middleware.rs` (~2 calls), and `auth/mod.rs` public functions (~6 calls) also gain `.await`.

The `auth/` public functions (`create_session`, `validate_session`, `accept_invite`, `create_invite_link`) become async, which cascades to their callers in `api/auth.rs`, `api/middleware.rs`, and `sync/ws.rs`.

This is the largest mechanical change in the lot. It is entirely mechanical (add `.await`), but the scope is ~270 total sites across ~25 files.

**`Db` stays `Clone`**: `tokio_rusqlite::Connection` is internally `Arc`-wrapped and clone-safe.

**Async callers of `Db::new()`**:
- `main.rs` HTTP server path — already in `#[tokio::main]` async context, straightforward
- `main.rs` `reset_password` CLI path — must become async
- `main.rs` `run_mcp_stdio` path — must become async. Note: the current blocking `for line in stdin.lock().lines()` loop must be restructured to use `tokio::io::BufReader` on `tokio::io::stdin()` since the MCP tool handlers (`handle_query`, etc.) will be async and need `.await` inside the loop body
- `Db::in_memory()` in tests — test functions must be `#[tokio::test]`

**Pragmas**: WAL and `busy_timeout` are currently set in `Db::new()`. `foreign_keys` is set in `migrations.rs` (lines 7-9). After migration, consolidate all three pragmas into `Db::new()` inside the initial `call()` and remove them from `migrations.rs`. Note: `foreign_keys` is per-connection (not persisted), so it must be set on every connection open — `Db::new()` is the correct place.

### Testing

- `Db::in_memory()` continues to work for unit tests (must use `#[tokio::test]`)
- Existing backend tests verify no regressions after migration
- Add a concurrent read test: spawn 10 tasks reading the same board simultaneously

### Dependencies

- Add `tokio-rusqlite` to `crates/server/Cargo.toml`
- Keep `rusqlite` as transitive dependency (accessed via `tokio_rusqlite::Connection::call`)

## 2. Background Cleanup Tasks

### Problem

**Sessions**: Expired sessions (30-day TTL) accumulate in the `sessions` table. Cleanup is probabilistic (~1/256 chance per validation call), which means expired rows can persist for days.

**Rate limiter**: The in-memory `HashMap<String, Vec<Instant>>` grows unbounded. Cleanup is also probabilistic (`rand::random::<u8>() == 0`), allowing up to 10k+ stale IP entries.

### Solution

Replace probabilistic cleanup with deterministic periodic background tasks using `tokio::time::interval`.

### Design

**New function in `main.rs`**:
```rust
fn spawn_cleanup_tasks(db: Db, rate_limiter: RateLimiter) {
    let db_clone = db.clone();
    // Session cleanup — every hour
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match db_clone.cleanup_expired_sessions().await {
                Ok(count) if count > 0 => tracing::info!("Purged {count} expired sessions"),
                Err(e) => tracing::warn!("Session cleanup failed: {e}"),
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

Note: `db` is cloned explicitly for the first task. If future cleanup tasks need DB access, clone again before each `tokio::spawn`.

**Session cleanup**: A free function `cleanup_expired_sessions` already exists in `auth/mod.rs`. Move it to a `Db` method for consistency, using the existing SQL approach (`Utc::now().to_rfc3339()` as parameter, not `datetime('now')`) to match the RFC 3339 format used for `expires_at` values in the sessions table:
```rust
impl Db {
    pub async fn cleanup_expired_sessions(&self) -> anyhow::Result<usize> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(move |conn| {
            let count = conn.execute("DELETE FROM sessions WHERE expires_at <= ?1", [&now])?;
            Ok(count)
        }).await
    }
}
```

**New RateLimiter method**: `RateLimiter::sweep() -> usize` — acquires the lock, first prunes all timestamps older than the window from every entry, then removes entries with empty timestamp vecs, returns count of removed IPs.

**Removals**:
- Remove probabilistic cleanup in `auth/mod.rs` (the `rand::random::<u8>() == 0` block in `validate_session`)
- Remove probabilistic cleanup in `rate_limit.rs` (the `rand::random::<u8>() == 0 || map.len() > MAX_TRACKED_IPS` block)
- Keep `rand` dependency — it is used for token generation in `auth/mod.rs` and session IDs in `mcp/sse.rs`

### Intervals

| Task | Interval | Rationale |
|------|----------|-----------|
| Session cleanup | 1 hour | Sessions expire at 30 days. Hourly is sufficient, low DB cost. |
| Rate limiter sweep | 5 minutes | Rate window is 60s. 5min ensures max ~5 windows of stale data. |

### Testing

- Unit test: create expired sessions, call `cleanup_expired_sessions`, verify they're gone
- Unit test: `RateLimiter::sweep()` removes stale entries, preserves active ones
- Integration: verify cleanup tasks start on server boot (log output)

## 3. WebSocket Reconnect (Client)

### Problem

`frontend/src/lib/sync.ts` creates a `y-websocket` `WebsocketProvider` on mount. If the connection drops (network change, laptop sleep, server restart), the client does not reconnect. The user sees a frozen board with no indication of the problem.

### Solution

Configure `y-websocket`'s built-in reconnect (it already implements exponential backoff) and add a minimal connection status indicator.

### Design

**`y-websocket` already reconnects**: The `WebsocketProvider` in `y-websocket@3.0.0` has built-in reconnect with exponential backoff (`2^n * 100ms`, default cap at 2500ms). No custom reconnect logic is needed. The work is:

1. **Configure `maxBackoffTime`**: Set to `30000` (30s) in the `WebsocketProvider` constructor to match our desired cap:
```typescript
new WebsocketProvider(wsUrl, roomName, doc, {
  maxBackoffTime: 30000,
  // connect: true (default)
})
```

2. **Expose connection status**: Listen to the provider's `status` event (already emitted by `y-websocket`) and expose it via the `useSync` hook. The existing hook exposes `connected: boolean` — replace this with a richer status:
```typescript
interface SyncState {
  status: 'connected' | 'connecting' | 'disconnected'
}
```
The provider emits `{ status: 'connected' | 'connecting' | 'disconnected' }` events. Wire these to React state. Update existing consumers that check `connected` to use `status === 'connected'` instead.

3. **Build `ConnectionStatus` component**: A minimal UI indicator:
- Renders in `AppLayout`, positioned subtly (e.g. bottom-left or top-right corner)
- **Connected**: hidden (no indicator)
- **Connecting**: small pulsing dot + "Reconnecting..." text, muted color
- **Disconnected** (after multiple failures): small static dot + "Offline" text
- No toasts, no banners, no modals. Minimal and non-intrusive.
- Disappears automatically when connection restores

**Re-sync on reconnect**: The server already sends the full Y.Doc state on WebSocket connect (`handle_socket` in `ws.rs` sends `initial_state`). The client merges it via Yjs CRDT — no special handling needed, conflicts are resolved automatically.

### Testing

- E2E test: connect to board, kill WS server, verify "Reconnecting..." appears, restart server, verify auto-reconnect and indicator disappears
- Manual test: close laptop lid, reopen, verify board resumes sync

## Files Modified

| File | Change |
|------|--------|
| **Database layer** | |
| `crates/server/Cargo.toml` | Add `tokio-rusqlite` |
| `crates/server/src/db/mod.rs` | Rewrite `Db` to use `tokio_rusqlite::Connection`, consolidate all pragmas |
| `crates/server/src/db/repo.rs` | Make all ~69 `with_conn` calls async, all public methods become async |
| `crates/server/src/db/migrations.rs` | Run migrations inside async `call()`, remove pragma lines (moved to `Db::new`) |
| **Entrypoints** | |
| `crates/server/src/main.rs` | Make DB init async, make `reset_password` async, restructure `run_mcp_stdio` to async (replace blocking stdin loop with `tokio::io`), add `spawn_cleanup_tasks()` |
| **Auth** | |
| `crates/server/src/auth/mod.rs` | Make `create_session`, `validate_session`, `accept_invite`, `create_invite_link` async. Remove probabilistic cleanup. Move `cleanup_expired_sessions` to `Db` method. |
| **API handlers (14 modules)** | |
| `crates/server/src/api/auth.rs` | Add `.await` to auth function calls |
| `crates/server/src/api/boards.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/tasks.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/columns.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/labels.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/subtasks.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/comments.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/custom_fields.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/archive.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/attachments.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/search.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/activity.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/permissions.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/api_keys.rs` | Add `.await` to Db method calls |
| `crates/server/src/api/middleware.rs` | Add `.await` to `validate_session` and `validate_api_key` calls |
| **MCP** | |
| `crates/server/src/mcp/tools.rs` | Add `.await` to ~64 Db method calls |
| `crates/server/src/mcp/board_ask.rs` | Add `.await` to ~8 `with_conn` calls |
| `crates/server/src/mcp/sse.rs` | Add `.await` to handler calls (`handle_query`, `handle_mutate`, `handle_sync`) |
| **Sync** | |
| `crates/server/src/sync/ws.rs` | Add `.await` to ~4 Db method calls (`validate_api_key`, `get_board_member`, `save_crdt_state`) |
| `crates/server/src/sync/doc.rs` | Add `.await` to Db method calls in `init_from_db` |
| **Cleanup tasks** | |
| `crates/server/src/api/rate_limit.rs` | Remove probabilistic cleanup, add `sweep()` method |
| **Frontend** | |
| `frontend/src/lib/sync.ts` | Configure `maxBackoffTime: 30000` on WebsocketProvider |
| `frontend/src/hooks/useSync.ts` | Replace `connected: boolean` with `status` from provider events, update consumers |
| `frontend/src/components/board/ConnectionStatus.tsx` | New component — connection indicator |
| `frontend/src/layouts/AppLayout.tsx` | Render `ConnectionStatus` |

**Total**: ~25-30 backend files, 4 frontend files. ~270 `.await` additions (mechanical).

## Out of Scope

- Multiple SQLite connections / read replicas (single `tokio_rusqlite::Connection` is sufficient for current scale)
- Server-side WebSocket heartbeat / ping-pong (y-websocket handles this)
- Graceful shutdown of background tasks (acceptable for v1 — tasks terminate with the process)
- Offline mode (Lot 6)

## Success Criteria

1. No `std::sync::Mutex` on database connections — all DB access is async
2. Expired sessions are cleaned up within 1 hour of expiry
3. Rate limiter memory is bounded (no unbounded growth)
4. WebSocket reconnects automatically after network interruption within 30 seconds
5. All existing tests pass after migration
6. No user-visible behavior change except the new connection status indicator
