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

**Call site migration**: Every call to `db.with_conn(...)` gains `.await`. ~87 call sites total, concentrated in `db/repo.rs` (~69), `mcp/board_ask.rs` (~8), `auth/mod.rs` (~6), `api/auth.rs` (~4).

**`Db` stays `Clone`**: `tokio_rusqlite::Connection` is internally `Arc`-wrapped and clone-safe.

**Async callers**: `Db::new()` becoming async affects all construction sites:
- `main.rs` HTTP server path (already in `#[tokio::main]` async context — straightforward)
- `main.rs` `reset_password` CLI path — must become async or use `.await` within the async main
- `main.rs` `run_mcp_stdio` path — must become async
- `Db::in_memory()` in tests — test functions must be `#[tokio::test]`

**Pragmas**: WAL and `busy_timeout` are currently set in `Db::new()`. `foreign_keys` is set in `migrations.rs`. After migration, consolidate all pragmas into `Db::new()` inside the initial `call()` for clarity.

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

**New RateLimiter method**: `RateLimiter::sweep() -> usize` — acquires the lock, removes all entries with no timestamps within the current window, returns count of removed IPs.

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

2. **Expose connection status**: Listen to the provider's `status` event (already emitted by `y-websocket`) and expose it via the `useSync` hook:
```typescript
interface SyncState {
  status: 'connected' | 'connecting' | 'disconnected'
}
```
The provider emits `{ status: 'connected' | 'connecting' | 'disconnected' }` events. Wire these to React state.

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
| `crates/server/Cargo.toml` | Add `tokio-rusqlite` |
| `crates/server/src/db/mod.rs` | Rewrite `Db` to use `tokio_rusqlite::Connection`, consolidate pragmas |
| `crates/server/src/db/repo.rs` | Add `.await` to ~69 `with_conn` calls |
| `crates/server/src/db/migrations.rs` | Run migrations inside async `call()`, move `foreign_keys` pragma to `Db::new` |
| `crates/server/src/main.rs` | Make DB init async, make `reset_password` and `run_mcp_stdio` async, add `spawn_cleanup_tasks()` |
| `crates/server/src/api/auth.rs` | Add `.await` to ~4 `with_conn` calls |
| `crates/server/src/auth/mod.rs` | Add `.await` to ~6 calls, remove probabilistic cleanup, move `cleanup_expired_sessions` to `Db` method |
| `crates/server/src/mcp/board_ask.rs` | Add `.await` to ~8 `with_conn` calls |
| `crates/server/src/mcp/*.rs` | Add `.await` to any other `with_conn` calls |
| `crates/server/src/sync/doc.rs` | Add `.await` to `Db` method calls (indirect via `init_from_db`) |
| `crates/server/src/api/rate_limit.rs` | Remove probabilistic cleanup, add `sweep()` method |
| `frontend/src/lib/sync.ts` | Configure `maxBackoffTime: 30000` on WebsocketProvider |
| `frontend/src/hooks/useSync.ts` | Expose connection status from provider's `status` events |
| `frontend/src/components/board/ConnectionStatus.tsx` | New component — connection indicator |
| `frontend/src/layouts/AppLayout.tsx` | Render `ConnectionStatus` |

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
