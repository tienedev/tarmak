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

**Call site migration**: Every call to `db.with_conn(...)` gains `.await`. This is mechanical — the closure signatures remain identical. Estimated ~60 call sites across `api/`, `auth/`, `mcp/`, `sync/`.

**`Db` stays `Clone`**: `tokio_rusqlite::Connection` is internally `Arc`-wrapped and clone-safe.

### Testing

- `Db::in_memory()` continues to work for unit tests (also async now)
- Existing backend tests verify no regressions after migration
- Add a concurrent read test: spawn 10 tasks reading the same board simultaneously

### Dependencies

- Add `tokio-rusqlite` to `crates/server/Cargo.toml`
- Remove direct `rusqlite` dependency if fully replaced, or keep it as transitive

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
    // Session cleanup — every hour
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match db.cleanup_expired_sessions().await {
                Ok(count) => tracing::info!("Purged {count} expired sessions"),
                Err(e) => tracing::warn!("Session cleanup failed: {e}"),
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

**New DB method**: `Db::cleanup_expired_sessions() -> Result<usize>` — executes `DELETE FROM sessions WHERE expires_at < datetime('now')` and returns the number of deleted rows.

**New RateLimiter method**: `RateLimiter::sweep() -> usize` — acquires the lock, removes all entries with no timestamps within the current window, returns count of removed IPs.

**Removals**:
- Remove probabilistic cleanup in `auth/mod.rs` (the `rand::random::<u8>() == 0` block in `validate_session`)
- Remove probabilistic cleanup in `rate_limit.rs` (the `rand::random::<u8>() == 0 || map.len() > MAX_TRACKED_IPS` block)
- Remove `rand` dependency if no longer used elsewhere

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

Implement automatic reconnection with exponential backoff and a minimal connection status indicator.

### Design

**Reconnection logic in `sync.ts`**:

The `y-websocket` `WebsocketProvider` has built-in reconnect support. Verify and configure:
- If `WebsocketProvider` handles reconnect natively: configure its `resyncInterval` and connection parameters
- If manual reconnect is needed: listen to `status` events on the provider, implement backoff on `disconnected`

**Backoff schedule**: 1s → 2s → 4s → 8s → 16s → 30s (cap). Reset to 1s on successful reconnection.

**Max retries**: Unlimited. Yjs buffers local edits in memory — the board remains usable in read/write mode. Edits sync automatically when connection restores.

**State exposed by `useSync` hook**:
```typescript
interface SyncState {
  status: 'connected' | 'connecting' | 'disconnected'
  retryCount: number
}
```

**UI indicator — `ConnectionStatus` component**:
- Renders in `AppLayout`, positioned subtly (e.g. bottom-left or top-right corner)
- **Connected**: hidden (no indicator)
- **Connecting**: small pulsing dot + "Reconnecting..." text, muted color
- **Disconnected** (after multiple failures): small static dot + "Offline" text
- No toasts, no banners, no modals. Minimal and non-intrusive.
- Disappears automatically when connection restores

**Re-sync on reconnect**: The server already sends the full Y.Doc state on WebSocket connect (`handle_socket` in `ws.rs` sends `initial_state`). The client merges it via Yjs CRDT — no special handling needed, conflicts are resolved automatically.

### Testing

- E2E test: connect to board, kill WS server, verify "Reconnecting..." appears, restart server, verify auto-reconnect and indicator disappears
- Unit test: backoff schedule produces correct delays (1, 2, 4, 8, 16, 30, 30, 30...)

## Files Modified

| File | Change |
|------|--------|
| `crates/server/Cargo.toml` | Add `tokio-rusqlite`, possibly remove `rand` |
| `crates/server/src/db/mod.rs` | Rewrite `Db` to use `tokio_rusqlite::Connection` |
| `crates/server/src/db/repo.rs` | Add `.await` to all `with_conn` calls |
| `crates/server/src/db/migrations.rs` | Run migrations inside async `call()` |
| `crates/server/src/main.rs` | Make DB init async, add `spawn_cleanup_tasks()` |
| `crates/server/src/api/*.rs` | Add `.await` to `with_conn` calls (~19 modules) |
| `crates/server/src/auth/mod.rs` | Add `.await`, remove probabilistic cleanup, add `cleanup_expired_sessions` |
| `crates/server/src/mcp/*.rs` | Add `.await` to `with_conn` calls |
| `crates/server/src/sync/doc.rs` | Add `.await` to `with_conn` calls |
| `crates/server/src/api/rate_limit.rs` | Remove probabilistic cleanup, add `sweep()` method |
| `frontend/src/lib/sync.ts` | Add reconnect logic with backoff |
| `frontend/src/hooks/useSync.ts` | Expose connection status |
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
