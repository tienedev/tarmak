# Lot 3a — Notifications & Mentions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, real-time notifications triggered by assignments, comments, @mentions, and deadlines, with SSE delivery and Tiptap mention autocomplete.

**Architecture:** v8 migration adds `notifications` table. A `NotifTx` Extension (tokio broadcast channel) distributes events to SSE streams. Triggers are injected directly into existing API handlers via shared helper functions in `notifications.rs`. Frontend replaces the client-only notification store with a backend-synced version using SSE + polling fallback. Tiptap mention extension enables @user autocomplete in comments.

**Tech Stack:** Rust (Axum, rusqlite, tokio broadcast), React, TypeScript, Tiptap v3, @tiptap/extension-mention, Zustand, EventSource

**Spec:** `docs/superpowers/specs/2026-03-17-lot3a-notifications-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | v8 migration (notifications table + index) |
| `crates/server/src/db/models.rs` | `Notification` struct |
| `crates/server/src/db/repo.rs` | Notification CRUD: create, list, unread_count, mark_read, mark_all_read, get_task_participants |
| `crates/server/src/notifications.rs` | **New** — `NotifTx` type, mention parser, shared trigger helpers |
| `crates/server/src/api/notifications.rs` | **New** — REST + SSE handlers + stream-ticket |
| `crates/server/src/api/mod.rs` | Add `pub mod notifications;`, notification routes, `patch` import |
| `crates/server/src/api/tasks.rs` | Assignment trigger in `update` handler |
| `crates/server/src/api/comments.rs` | Comment + mention triggers in `create`/`update` |
| `crates/server/src/background.rs` | **New** — Deadline check background task |
| `crates/server/src/main.rs` | `mod notifications; mod background;`, wire NotifTx Extension, spawn deadline task |
| `crates/server/src/mcp/tools.rs` | Notification triggers in board_mutate comment/task actions |
| `frontend/package.json` | Add `@tiptap/extension-mention` |
| `frontend/src/lib/api.ts` | `Notification` type + API methods |
| `frontend/src/stores/notifications.ts` | Refactor: backend-synced store + SSE client |
| `frontend/src/components/notifications/NotificationBell.tsx` | Use real data, navigation on click |
| `frontend/src/components/editor/TiptapEditor.tsx` | Mention extension integration |
| `frontend/src/components/editor/MentionList.tsx` | **New** — suggestion dropdown component |

**Total:** 17 files (13 modified, 4 new).

---

## Chunk 1: Backend Foundation

### Task 1: v8 Migration

**Files:**
- Modify: `crates/server/src/db/migrations.rs`

- [ ] **Step 1: Add v8 migration function**

Add after the `v7()` function (~line 459):

```rust
fn v8(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction().context("begin v8 transaction")?;
    tx.execute_batch(
        "
        CREATE TABLE notifications (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
            type       TEXT NOT NULL,
            title      TEXT NOT NULL,
            body       TEXT,
            read       INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX idx_notifications_user_unread
            ON notifications(user_id, read, created_at);

        INSERT INTO schema_version (version) VALUES (8);
        ",
    )
    .context("v8 migration")?;
    tx.commit().context("commit v8")?;
    Ok(())
}
```

- [ ] **Step 2: Wire v8 into `run_migrations`**

Add after the `if current < 7` block:

```rust
if current < 8 { v8(conn).context("applying migration v8")?; }
```

- [ ] **Step 3: Update all migration test assertions**

Search for `assert_eq!(ver, 7` and replace all occurrences with `assert_eq!(ver, 8`. Add a spot-check:

```rust
conn.execute_batch("SELECT id, user_id, type, title, read FROM notifications LIMIT 0").unwrap();
```

- [ ] **Step 4: Run tests**

Run: `cargo test -- migrations`
Expected: All 3 migration tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/db/migrations.rs
git commit -m "feat(db): add v8 migration — notifications table"
```

---

### Task 2: Notification Model

**Files:**
- Modify: `crates/server/src/db/models.rs`

- [ ] **Step 1: Add Notification struct**

Add after the `ActivityEntry` struct (~line 255):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub title: String,
    pub body: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}
```

Note: The DB column is `type` but the Rust field is `notification_type` to avoid `r#type`. The `#[serde(rename = "type")]` ensures the JSON key is `"type"`.

- [ ] **Step 2: Verify compilation**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/models.rs
git commit -m "feat(models): add Notification struct"
```

---

### Task 3: Notification Db Methods

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Add `create_notification` method**

Add in the main `impl Db` block (after comment methods):

```rust
pub async fn create_notification(
    &self,
    user_id: &str,
    board_id: &str,
    task_id: Option<&str>,
    notif_type: &str,
    title: &str,
    body: Option<&str>,
) -> anyhow::Result<Notification> {
    let user_id = user_id.to_string();
    let board_id = board_id.to_string();
    let task_id = task_id.map(String::from);
    let notif_type = notif_type.to_string();
    let title = title.to_string();
    let body = body.map(String::from);
    self.with_conn(move |conn| {
        let id = new_id();
        let now = now_iso();
        conn.execute(
            "INSERT INTO notifications (id, user_id, board_id, task_id, type, title, body, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, user_id, board_id, task_id, notif_type, title, body, now],
        )
        .context("insert notification")?;
        Ok(Notification {
            id,
            user_id,
            board_id,
            task_id,
            notification_type: notif_type,
            title,
            body,
            read: false,
            created_at: Utc::now(),
        })
    })
    .await
}
```

- [ ] **Step 2: Add `list_notifications` method**

```rust
pub async fn list_notifications(
    &self,
    user_id: &str,
    unread_only: bool,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<Notification>> {
    let user_id = user_id.to_string();
    self.with_conn(move |conn| {
        let sql = if unread_only {
            "SELECT id, user_id, board_id, task_id, type, title, body, read, created_at
             FROM notifications WHERE user_id = ?1 AND read = 0
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
        } else {
            "SELECT id, user_id, board_id, task_id, type, title, body, read, created_at
             FROM notifications WHERE user_id = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(params![user_id, limit, offset], |row| {
            Ok(Notification {
                id: row.get(0)?,
                user_id: row.get(1)?,
                board_id: row.get(2)?,
                task_id: row.get(3)?,
                notification_type: row.get(4)?,
                title: row.get(5)?,
                body: row.get(6)?,
                read: row.get::<_, i64>(7)? != 0,
                created_at: parse_dt(&row.get::<_, String>(8)?)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}
```

- [ ] **Step 3: Add `unread_notification_count` method**

```rust
pub async fn unread_notification_count(&self, user_id: &str) -> anyhow::Result<i64> {
    let user_id = user_id.to_string();
    self.with_conn(move |conn| {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND read = 0",
            params![user_id],
            |row| row.get(0),
        )?;
        Ok(count)
    })
    .await
}
```

- [ ] **Step 4: Add `mark_notification_read` and `mark_all_notifications_read`**

```rust
pub async fn mark_notification_read(&self, notification_id: &str, user_id: &str) -> anyhow::Result<bool> {
    let notification_id = notification_id.to_string();
    let user_id = user_id.to_string();
    self.with_conn(move |conn| {
        let rows = conn.execute(
            "UPDATE notifications SET read = 1 WHERE id = ?1 AND user_id = ?2",
            params![notification_id, user_id],
        )?;
        Ok(rows > 0)
    })
    .await
}

pub async fn mark_all_notifications_read(&self, user_id: &str) -> anyhow::Result<u64> {
    let user_id = user_id.to_string();
    self.with_conn(move |conn| {
        let rows = conn.execute(
            "UPDATE notifications SET read = 1 WHERE user_id = ?1 AND read = 0",
            params![user_id],
        )? as u64;
        Ok(rows)
    })
    .await
}
```

- [ ] **Step 5: Add `get_task_participant_ids` method**

This returns user IDs who are "participants" of a task: the assignee (if set) + users who have previously commented on the task.

```rust
pub async fn get_task_participant_ids(&self, task_id: &str) -> anyhow::Result<Vec<String>> {
    let task_id = task_id.to_string();
    self.with_conn(move |conn| {
        let mut ids = Vec::new();
        // Get assignee
        let assignee: Option<String> = conn
            .query_row("SELECT assignee FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
            .optional()?
            .flatten();
        if let Some(a) = assignee {
            if !a.is_empty() {
                // Resolve assignee name to user_id
                let uid: Option<String> = conn
                    .query_row("SELECT id FROM users WHERE name = ?1", params![a], |r| r.get(0))
                    .optional()?;
                if let Some(uid) = uid {
                    ids.push(uid);
                }
            }
        }
        // Get previous commenters
        let mut stmt = conn.prepare(
            "SELECT DISTINCT user_id FROM comments WHERE task_id = ?1",
        )?;
        let rows = stmt.query_map(params![task_id], |row| row.get::<_, String>(0))?;
        for r in rows {
            let uid = r?;
            if !ids.contains(&uid) {
                ids.push(uid);
            }
        }
        Ok(ids)
    })
    .await
}
```

Note: The `assignee` field on tasks stores the user **name** (not user_id). This is confirmed in `api/tasks.rs` where `body.assignee` is passed as `Option<Option<&str>>` directly from the request body. We resolve it to user_id via `SELECT id FROM users WHERE name = ?1`.

- [ ] **Step 6: Add `has_deadline_notification` method**

For deduplication in the deadline background task:

```rust
pub async fn has_deadline_notification(&self, task_id: &str, user_id: &str) -> anyhow::Result<bool> {
    let task_id = task_id.to_string();
    let user_id = user_id.to_string();
    self.with_conn(move |conn| {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notifications
             WHERE task_id = ?1 AND user_id = ?2 AND type = 'deadline'",
            params![task_id, user_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    })
    .await
}
```

- [ ] **Step 7: Verify compilation**

Run: `cargo check`
Expected: Compiles (dead_code warnings for unused methods are OK at this stage).

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat(db): add notification CRUD methods and task participant query"
```

---

### Task 4: Notification Service Module

**Files:**
- Create: `crates/server/src/notifications.rs`

- [ ] **Step 1: Create the module with NotifTx type and mention parser**

```rust
use regex::Regex;
use std::sync::LazyLock;
use tokio::sync::broadcast;

use crate::db::Db;
use crate::db::models::Notification;

/// Broadcast channel wrapper for notification delivery.
/// Added as an Axum `Extension` so handlers can extract it.
#[derive(Clone)]
pub struct NotifTx(pub broadcast::Sender<(String, Notification)>);

/// Send a notification on the broadcast channel (fire-and-forget).
/// Errors (no active receivers) are silently ignored.
pub fn broadcast(tx: &NotifTx, notif: &Notification) {
    let _ = tx.0.send((notif.user_id.clone(), notif.clone()));
}

// ---------------------------------------------------------------------------
// Mention parser
// ---------------------------------------------------------------------------

static MENTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<span[^>]*data-type="mention"[^>]*data-id="([^"]+)"[^>]*>"#).unwrap()
});

/// Extract mentioned user IDs from Tiptap HTML content.
pub fn parse_mentions(html: &str) -> Vec<String> {
    MENTION_RE
        .captures_iter(html)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// Shared trigger helpers
// ---------------------------------------------------------------------------

/// Create notification for each recipient, broadcast each.
/// Skips `exclude_user_id` (typically the actor).
pub async fn notify_users(
    db: &Db,
    tx: &NotifTx,
    recipients: &[String],
    exclude_user_id: &str,
    board_id: &str,
    task_id: Option<&str>,
    notif_type: &str,
    title: &str,
) {
    for uid in recipients {
        if uid == exclude_user_id {
            continue;
        }
        if let Ok(notif) = db
            .create_notification(uid, board_id, task_id, notif_type, title, None)
            .await
        {
            broadcast(tx, &notif);
        }
    }
}
```

- [ ] **Step 2: Add unit tests for `parse_mentions`**

Add at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mentions_basic() {
        let html = r#"<p>Hello <span data-type="mention" data-id="user-1" class="mention">@Alice</span></p>"#;
        assert_eq!(parse_mentions(html), vec!["user-1"]);
    }

    #[test]
    fn test_parse_mentions_multiple() {
        let html = r#"<p><span data-type="mention" data-id="u1" class="mention">@A</span> and <span data-type="mention" data-id="u2" class="mention">@B</span></p>"#;
        assert_eq!(parse_mentions(html), vec!["u1", "u2"]);
    }

    #[test]
    fn test_parse_mentions_none() {
        assert!(parse_mentions("<p>no mentions</p>").is_empty());
    }
}
```

- [ ] **Step 3: Add `regex` dependency**

Check if `regex` is already in `Cargo.toml`. If not, add it:

Run: `grep -q '^regex' crates/server/Cargo.toml && echo "already present" || echo "needs adding"`

If needed: add `regex = "1"` to `[dependencies]` in `crates/server/Cargo.toml`.

- [ ] **Step 4: Add `mod notifications;` to `main.rs`**

In `crates/server/src/main.rs`, find the module declarations at the top and add:

```rust
mod notifications;
```

- [ ] **Step 5: Run mention parser tests**

Run: `cargo test -- notifications::tests`
Expected: All 3 tests pass.

- [ ] **Step 6: Verify compilation**

Run: `cargo check`

- [ ] **Step 7: Commit**

```bash
git add crates/server/src/notifications.rs crates/server/src/main.rs crates/server/Cargo.toml
git commit -m "feat: add notification service module with broadcast channel and mention parser"
```

---

## Chunk 2: Backend API

### Task 5: Notification REST + SSE Handlers

**Files:**
- Create: `crates/server/src/api/notifications.rs`
- Modify: `crates/server/src/api/mod.rs`

- [ ] **Step 1: Create the notifications API module**

Create `crates/server/src/api/notifications.rs`:

```rust
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use dashmap::DashMap;
use futures::stream::Stream;
use serde::Deserialize;
use tokio_stream::StreamExt as _;
use tokio_stream::wrappers::BroadcastStream;

use crate::db::Db;
use crate::db::models::Notification;
use crate::notifications::NotifTx;
use super::error::ApiError;
use super::middleware::AuthUser;

// ---------------------------------------------------------------------------
// Stream ticket store (in-memory, short-lived)
// ---------------------------------------------------------------------------

/// In-memory store for SSE stream tickets. Shared via Extension.
#[derive(Clone, Default)]
pub struct TicketStore(pub Arc<DashMap<String, (String, Instant)>>);

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListParams {
    pub unread_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct StreamParams {
    pub ticket: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<Notification>>, ApiError> {
    let notifs = db
        .list_notifications(
            &user.id,
            params.unread_only.unwrap_or(false),
            params.limit.unwrap_or(50),
            params.offset.unwrap_or(0),
        )
        .await?;
    Ok(Json(notifs))
}

pub async fn unread_count(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let count = db.unread_notification_count(&user.id).await?;
    Ok(Json(serde_json::json!({ "count": count })))
}

pub async fn mark_read(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let updated = db.mark_notification_read(&id, &user.id).await?;
    if !updated {
        return Err(ApiError::NotFound("notification not found".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn mark_all_read(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
) -> Result<Json<serde_json::Value>, ApiError> {
    let count = db.mark_all_notifications_read(&user.id).await?;
    Ok(Json(serde_json::json!({ "updated": count })))
}

// ---------------------------------------------------------------------------
// Stream ticket
// ---------------------------------------------------------------------------

pub async fn create_stream_ticket(
    AuthUser(user): AuthUser,
    Extension(store): Extension<TicketStore>,
) -> Json<serde_json::Value> {
    // Clean expired tickets opportunistically
    store.0.retain(|_, (_, exp)| exp.elapsed() < Duration::from_secs(60));

    let ticket = uuid::Uuid::new_v4().to_string();
    let expiry = Instant::now();
    store.0.insert(ticket.clone(), (user.id.clone(), expiry));
    Json(serde_json::json!({ "ticket": ticket }))
}

// ---------------------------------------------------------------------------
// SSE stream
// ---------------------------------------------------------------------------

pub async fn stream(
    Query(params): Query<StreamParams>,
    Extension(store): Extension<TicketStore>,
    Extension(tx): Extension<NotifTx>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    // Validate ticket
    let (_, entry) = store
        .0
        .remove(&params.ticket)
        .ok_or_else(|| ApiError::Forbidden("invalid or expired ticket".into()))?;
    let (user_id, created) = entry;
    if created.elapsed() > Duration::from_secs(60) {
        return Err(ApiError::Forbidden("ticket expired".into()));
    }

    let rx = tx.0.subscribe();

    // Prepend a "connected" event, then stream notifications
    let connected = futures::stream::once(async {
        Ok::<_, Infallible>(Event::default().event("connected").data("{}"))
    });
    let notifications = BroadcastStream::new(rx).filter_map(move |result| {
        match result {
            Ok((uid, notif)) if uid == user_id => {
                let data = serde_json::to_string(&notif).unwrap_or_default();
                Some(Ok(Event::default().event("notification").data(data)))
            }
            Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                tracing::warn!("SSE client lagged, skipped {n} notifications");
                None
            }
            _ => None, // Wrong user
        }
    });
    let stream = connected.chain(notifications);

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .event(Event::default().event("ping").data("{}")),
    ))
}
```

Note: Check if `dashmap`, `futures`, and `tokio-stream` are already in the crate's dependencies. If not, add them:
- `dashmap = "6"` (or whatever version is compatible)
- `futures = "0.3"`
- `tokio-stream = "0.1"`

Note: `new_id()` in `repo.rs` is private. The ticket handler uses `uuid::Uuid::new_v4().to_string()` directly instead.

- [ ] **Step 2: Add routes in `api/mod.rs`**

Add `pub mod notifications;` to the module declarations at the top (after `pub mod middleware;` ~line 13).

Add `patch` to the routing import if not already present. Current import is:
```rust
use axum::routing::{get, patch, post, put};
```
`patch` is already imported — good.

Add the notification router in the `router()` function, before the `protected` router construction (~line 118). Add it inside the `protected` block:

```rust
let notification_routes = Router::new()
    .route("/", get(notifications::list))
    .route("/unread-count", get(notifications::unread_count))
    .route("/read-all", patch(notifications::mark_all_read))
    .route("/{id}/read", patch(notifications::mark_read))
    .route("/stream", get(notifications::stream))
    .route("/stream-ticket", post(notifications::create_stream_ticket));
```

And nest it in the protected router:
```rust
.nest("/notifications", notification_routes)
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check`
Expected: Compiles (may need to add missing dependencies).

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/api/notifications.rs crates/server/src/api/mod.rs crates/server/Cargo.toml
git commit -m "feat(api): add notification REST endpoints and SSE stream with ticket auth"
```

---

### Task 6: Wire NotifTx and TicketStore in main.rs

**Files:**
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Create broadcast channel and add Extensions**

In `main.rs`, find where the HTTP server is set up. Add the broadcast channel creation and Extension layers.

After the `db` initialization and before the router is built:

```rust
let (notif_tx, _) = tokio::sync::broadcast::channel::<(String, crate::db::models::Notification)>(256);
let notif_tx = crate::notifications::NotifTx(notif_tx);
let ticket_store = crate::api::notifications::TicketStore::default();
```

Add Extension layers to the router. Find where `.with_state(db)` is called and add before it:

```rust
.layer(axum::Extension(notif_tx.clone()))
.layer(axum::Extension(ticket_store))
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/main.rs
git commit -m "feat: wire NotifTx broadcast channel and TicketStore into Axum extensions"
```

---

## Chunk 3: Backend Triggers

### Task 7: Assignment Trigger

**Files:**
- Modify: `crates/server/src/api/tasks.rs`

- [ ] **Step 1: Add assignment notification in the `update` handler**

In `tasks.rs`, find the `update` handler (~line 145-188). After the `update_task` call succeeds and before the return, detect assignee changes and trigger notification.

Add `Extension` import and extract `NotifTx`:

```rust
use axum::Extension;
use crate::notifications::{self, NotifTx};
```

Update the handler signature to include `Extension(tx): Extension<NotifTx>`.

After the existing `log_activity` call (~line 176), add:

```rust
// Trigger assignment notification
if body.assignee.is_some() {
    let new_assignee = task.assignee.as_deref().unwrap_or("");
    let old_assignee = existing.assignee.as_deref().unwrap_or("");
    if !new_assignee.is_empty() && new_assignee != old_assignee {
        // Resolve assignee name to user_id
        if let Ok(Some(assignee_user)) = db.get_user_by_name(new_assignee).await {
            if assignee_user.id != user.id {
                let title = format!("You were assigned to \"{}\"", task.title);
                if let Ok(notif) = db.create_notification(
                    &assignee_user.id, &board_id, Some(&tid), "assignment", &title, None,
                ).await {
                    notifications::broadcast(&tx, &notif);
                }
            }
        }
    }
}
```

`get_user_by_name` does not exist yet. Add it to `repo.rs` (in the same `impl Db` block):

```rust
pub async fn get_user_by_name(&self, name: &str) -> anyhow::Result<Option<User>> {
    let name = name.to_string();
    self.with_conn(move |conn| {
        let user = conn.query_row(
            "SELECT id, name, email, avatar_url, is_agent, created_at FROM users WHERE name = ?1",
            params![name],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    avatar_url: row.get(3)?,
                    is_agent: row.get::<_, i64>(4)? != 0,
                    created_at: parse_dt(&row.get::<_, String>(5)?)?,
                })
            },
        )
        .optional()?;
        Ok(user)
    })
    .await
}
```

- [ ] **Step 2: Verify compilation**

Run: `cargo check`

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/api/tasks.rs crates/server/src/db/repo.rs
git commit -m "feat: trigger assignment notification on task update"
```

---

### Task 8: Comment + Mention Triggers

**Files:**
- Modify: `crates/server/src/api/comments.rs`

- [ ] **Step 1: Add triggers in the `create` handler**

Add imports:
```rust
use axum::Extension;
use crate::notifications::{self, NotifTx, parse_mentions};
```

Update `create` handler signature to include `Extension(tx): Extension<NotifTx>`.

After the existing `log_activity` call, add:

```rust
// Trigger comment + mention notifications
let task = db.get_task(&tid).await?.unwrap_or_else(|| panic!("task {tid} must exist"));
let mentioned_ids = parse_mentions(&body.content);

// Notify task participants (assignee + previous commenters), excluding author
let participants = db.get_task_participant_ids(&tid).await.unwrap_or_default();
for pid in &participants {
    if pid == &user.id {
        continue;
    }
    // If user is mentioned, they get a mention notif instead of comment notif
    if mentioned_ids.contains(pid) {
        continue;
    }
    let title = format!("{} commented on \"{}\"", user.name, task.title);
    if let Ok(notif) = db.create_notification(pid, &board_id, Some(&tid), "comment", &title, None).await {
        notifications::broadcast(&tx, &notif);
    }
}

// Mention notifications
for mid in &mentioned_ids {
    if mid == &user.id {
        continue;
    }
    let title = format!("{} mentioned you in \"{}\"", user.name, task.title);
    if let Ok(notif) = db.create_notification(mid, &board_id, Some(&tid), "mention", &title, None).await {
        notifications::broadcast(&tx, &notif);
    }
}
```

Note: `AuthUser(pub User)` wraps `User { id, name, email, avatar_url, is_agent, created_at }`. Access `user.name` directly.

- [ ] **Step 2: Add mention trigger in the `update` handler**

Update `update` handler signature to include `Extension(tx): Extension<NotifTx>`.

Before the `update_comment` call, save the old content's mentions:

```rust
let old_mentions = parse_mentions(&comment.content);
```

After the update succeeds, compare and notify new mentions:

```rust
let new_mentions = parse_mentions(&body.content);
let task = db.get_task(&tid).await?.unwrap_or_else(|| panic!("task {tid} must exist"));
for mid in &new_mentions {
    if mid == &user.id || old_mentions.contains(mid) {
        continue; // Skip self and previously mentioned users
    }
    let title = format!("{} mentioned you in \"{}\"", user.name, task.title);
    if let Ok(notif) = db.create_notification(mid, &board_id, Some(&tid), "mention", &title, None).await {
        notifications::broadcast(&tx, &notif);
    }
}
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check`

- [ ] **Step 4: Commit**

```bash
git add crates/server/src/api/comments.rs
git commit -m "feat: trigger comment and mention notifications"
```

---

### Task 9: Deadline Background Task

**Files:**
- Create: `crates/server/src/background.rs`
- Modify: `crates/server/src/main.rs`

- [ ] **Step 1: Create the background module**

Create `crates/server/src/background.rs`:

```rust
use std::time::Duration;
use chrono::Utc;
use crate::db::Db;
use crate::notifications::{self, NotifTx};

/// Runs every hour. Creates deadline notifications for tasks due within 24h.
pub async fn deadline_checker(db: Db, tx: NotifTx) {
    let mut interval = tokio::time::interval(Duration::from_secs(3600));
    loop {
        interval.tick().await;
        if let Err(e) = check_deadlines(&db, &tx).await {
            tracing::error!("deadline checker error: {e}");
        }
    }
}

async fn check_deadlines(db: &Db, tx: &NotifTx) -> anyhow::Result<()> {
    let now = Utc::now();
    let tomorrow = now + chrono::Duration::hours(24);
    let now_str = now.format("%Y-%m-%d").to_string();
    let tomorrow_str = tomorrow.format("%Y-%m-%d").to_string();

    // Find tasks with due_date between now and now+24h that have an assignee
    let tasks = db.get_tasks_due_between(&now_str, &tomorrow_str).await?;

    for (task_id, board_id, title, assignee_name) in tasks {
        // Resolve assignee name to user_id
        let user = match db.get_user_by_name(&assignee_name).await? {
            Some(u) => u,
            None => continue,
        };

        // Skip if deadline notification already sent
        if db.has_deadline_notification(&task_id, &user.id).await? {
            continue;
        }

        let notif_title = format!("Task \"{}\" is due tomorrow", title);
        if let Ok(notif) = db
            .create_notification(&user.id, &board_id, Some(&task_id), "deadline", &notif_title, None)
            .await
        {
            notifications::broadcast(tx, &notif);
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Add `get_tasks_due_between` method to repo.rs**

```rust
/// Returns (task_id, board_id, title, assignee_name) for tasks due in the given date range.
pub async fn get_tasks_due_between(
    &self,
    from_date: &str,
    to_date: &str,
) -> anyhow::Result<Vec<(String, String, String, String)>> {
    let from = from_date.to_string();
    let to = to_date.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board_id, title, assignee FROM tasks
             WHERE due_date >= ?1 AND due_date <= ?2
             AND assignee IS NOT NULL AND assignee != ''
             AND archived = 0",
        )?;
        let rows = stmt.query_map(params![from, to], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
    .await
}
```

- [ ] **Step 3: Add `mod background;` to main.rs and spawn the task**

Add `mod background;` at the top of `main.rs`.

In the server startup function, after creating `notif_tx`, spawn the deadline checker:

```rust
tokio::spawn(background::deadline_checker(db.clone(), notif_tx.clone()));
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check`

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/background.rs crates/server/src/db/repo.rs crates/server/src/main.rs
git commit -m "feat: add deadline notification background task"
```

---

### Task 10: MCP Triggers

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`
- Modify: `crates/server/src/mcp/sse.rs`

The `KanbanMcpServer` struct currently holds only `db: Db`. We need to add `NotifTx` to it and thread it through construction.

- [ ] **Step 1: Add `NotifTx` to `KanbanMcpServer`**

In `mcp/tools.rs`, modify the struct and constructor:

```rust
use crate::notifications::{self, NotifTx, parse_mentions};
```

```rust
pub struct KanbanMcpServer {
    db: Db,
    notif_tx: NotifTx,
}

impl KanbanMcpServer {
    pub fn new(db: Db, notif_tx: NotifTx) -> Self {
        Self { db, notif_tx }
    }
```

- [ ] **Step 2: Update `McpSseHandler` in `mcp/sse.rs`**

`McpSseHandler::new()` constructs `KanbanMcpServer::new(db.clone())`. Update to pass `NotifTx`:

```rust
use crate::notifications::NotifTx;
```

Add `notif_tx: NotifTx` to `McpSseHandler` struct:

```rust
#[derive(Clone)]
pub struct McpSseHandler {
    server: Arc<KanbanMcpServer>,
    db: Db,
    user_id: String,
}

impl McpSseHandler {
    fn new(db: Db, user_id: String, notif_tx: NotifTx) -> Self {
        Self {
            server: Arc::new(KanbanMcpServer::new(db.clone(), notif_tx)),
            db,
            user_id,
        }
    }
}
```

Update `sse_router()` to accept and pass `NotifTx`:

```rust
pub fn sse_router(db: Db, notif_tx: NotifTx) -> Router<Db> {
```

Store `notif_tx` in `SseAppState` and pass it to `McpSseHandler::new()`. Wherever `McpSseHandler::new(db, user_id)` is called, add the `notif_tx` argument.

- [ ] **Step 3: Add notification triggers in `handle_mutate`**

In `mcp/tools.rs`, in the `update_task` action (~line 238), after the task update succeeds, add assignment trigger:

```rust
// Assignment notification trigger
let new_assignee = task.assignee.as_deref().unwrap_or("");
let old_assignee = existing.assignee.as_deref().unwrap_or("");
if !new_assignee.is_empty() && new_assignee != old_assignee {
    if let Ok(Some(assignee_user)) = self.db.get_user_by_name(new_assignee).await {
        // MCP actions are by the API key user — always notify the assignee
        let title = format!("You were assigned to \"{}\"", task.title);
        if let Ok(notif) = self.db.create_notification(
            &assignee_user.id, board_id, Some(&task.id), "assignment", &title, None,
        ).await {
            notifications::broadcast(&self.notif_tx, &notif);
        }
    }
}
```

In the `add_comment` action (~line 379), after creating the comment, add comment+mention triggers:

```rust
let mentioned_ids = parse_mentions(&content);
let participants = self.db.get_task_participant_ids(task_id).await.unwrap_or_default();
let actor_id = /* the user_id from the MCP session context */;

for pid in &participants {
    if pid == actor_id || mentioned_ids.contains(pid) { continue; }
    let title = format!("New comment on \"{}\"", task_title);
    if let Ok(notif) = self.db.create_notification(pid, board_id, Some(task_id), "comment", &title, None).await {
        notifications::broadcast(&self.notif_tx, &notif);
    }
}
for mid in &mentioned_ids {
    if mid == actor_id { continue; }
    let title = format!("You were mentioned in \"{}\"", task_title);
    if let Ok(notif) = self.db.create_notification(mid, board_id, Some(task_id), "mention", &title, None).await {
        notifications::broadcast(&self.notif_tx, &notif);
    }
}
```

Note: The MCP handler has access to the user_id via the session context. Check how `handle_mutate` accesses the calling user's ID and use that as `actor_id`.

- [ ] **Step 4: Update `sse_router` call site in `main.rs`**

In `main.rs`, update the call to `sse_router(db.clone())` to pass the `NotifTx`:

```rust
mcp::sse::sse_router(db.clone(), notif_tx.clone())
```

- [ ] **Step 5: Verify compilation**

Run: `cargo check`

- [ ] **Step 6: Run full test suite**

Run: `cargo test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add crates/server/src/mcp/tools.rs crates/server/src/mcp/sse.rs crates/server/src/main.rs
git commit -m "feat(mcp): add notification triggers to board_mutate actions"
```

---

## Chunk 4: Frontend

### Task 11: Install mention extension + API client

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Install @tiptap/extension-mention**

```bash
cd frontend && npm install @tiptap/extension-mention
```

- [ ] **Step 2: Add Notification type to api.ts**

Add after the `Comment` interface (~line 388):

```typescript
export interface ServerNotification {
  id: string
  user_id: string
  board_id: string
  task_id: string | null
  type: 'mention' | 'assignment' | 'deadline' | 'comment'
  title: string
  body: string | null
  read: boolean
  created_at: string
}
```

Note: Name it `ServerNotification` to avoid collision with the browser's built-in `Notification` API.

- [ ] **Step 3: Add notification API methods**

Add after the comment methods:

```typescript
// Notifications
listNotifications: (params?: { unread_only?: boolean; limit?: number; offset?: number }) =>
  request<ServerNotification[]>(`/notifications${params ? '?' + new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString() : ''}`),
getUnreadCount: () =>
  request<{ count: number }>('/notifications/unread-count'),
markNotificationRead: (id: string) =>
  request<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),
markAllNotificationsRead: () =>
  request<{ updated: number }>('/notifications/read-all', { method: 'PATCH' }),
getStreamTicket: () =>
  request<{ ticket: string }>('/notifications/stream-ticket', { method: 'POST' }),
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/api.ts
git commit -m "feat: add @tiptap/extension-mention and notification API client"
```

---

### Task 12: Refactor Notification Store

**Files:**
- Modify: `frontend/src/stores/notifications.ts`

- [ ] **Step 1: Rewrite the store**

Replace the entire file with a backend-synced version:

```typescript
import { create } from 'zustand'
import type { ServerNotification } from '@/lib/api'
import { api } from '@/lib/api'

interface NotificationState {
  notifications: ServerNotification[]
  unreadCount: number
  loading: boolean
  eventSource: EventSource | null

  // Backend-synced actions
  fetch: () => Promise<void>
  fetchUnreadCount: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismiss: (id: string) => void
  connectSSE: () => void
  disconnectSSE: () => void

  // Client-only toast (kept for backward compat with ~30 callers)
  add: (message: string) => void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  eventSource: null,

  fetch: async () => {
    set({ loading: true })
    try {
      const notifs = await api.listNotifications({ limit: 50 })
      set({ notifications: notifs, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchUnreadCount: async () => {
    try {
      const { count } = await api.getUnreadCount()
      set({ unreadCount: count })
    } catch {
      // ignore
    }
  },

  markRead: async (id: string) => {
    try {
      await api.markNotificationRead(id)
      set({
        notifications: get().notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
        unreadCount: Math.max(0, get().unreadCount - 1),
      })
    } catch {
      // ignore
    }
  },

  markAllRead: async () => {
    try {
      await api.markAllNotificationsRead()
      set({
        notifications: get().notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      })
    } catch {
      // ignore
    }
  },

  dismiss: (id: string) => {
    // Client-side only removal (maps to mark-as-read conceptually)
    const notif = get().notifications.find((n) => n.id === id)
    if (notif && !notif.read) {
      api.markNotificationRead(id).catch(() => {})
    }
    set({
      notifications: get().notifications.filter((n) => n.id !== id),
      unreadCount: notif && !notif.read ? Math.max(0, get().unreadCount - 1) : get().unreadCount,
    })
  },

  connectSSE: async () => {
    get().disconnectSSE()
    try {
      const { ticket } = await api.getStreamTicket()
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const es = new EventSource(`${baseUrl}/api/v1/notifications/stream?ticket=${ticket}`)
      es.addEventListener('notification', (event) => {
        const notif: ServerNotification = JSON.parse(event.data)
        set({
          notifications: [notif, ...get().notifications].slice(0, 50),
          unreadCount: get().unreadCount + 1,
        })
      })
      es.onerror = () => {
        // EventSource auto-reconnects, but we need a new ticket
        es.close()
        // Retry after 5 seconds
        setTimeout(() => get().connectSSE(), 5000)
      }
      set({ eventSource: es })
    } catch {
      // Fallback: poll every 30s
      const poll = setInterval(() => get().fetchUnreadCount(), 30000)
      // Store interval ID for cleanup (cast to any for simplicity)
      set({ eventSource: { close: () => clearInterval(poll) } as unknown as EventSource })
    }
  },

  disconnectSSE: () => {
    const es = get().eventSource
    if (es) {
      es.close()
      set({ eventSource: null })
    }
  },

  // Client-only toast method — backward compat for ~30 callers across the app
  // These are UI feedback messages (e.g. "Label created"), not server notifications.
  add: (message: string) => {
    const toast: ServerNotification = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user_id: '',
      board_id: '',
      task_id: null,
      type: 'comment',
      title: message,
      body: null,
      read: false,
      created_at: new Date().toISOString(),
    }
    set({
      notifications: [toast, ...get().notifications].slice(0, 50),
      unreadCount: get().unreadCount + 1,
    })
  },
}))
```

Note: The `add(message)` method is kept for backward compatibility. There are ~30 callers across 7 files (board.ts, TaskEditor.tsx, SubtaskList.tsx, FieldManager.tsx, LabelManager.tsx, SharePopover.tsx, BoardSettingsPanel.tsx) that use it as client-side toast feedback. The `add` method creates a local-only `ServerNotification` with an empty `user_id`/`board_id` so it displays in the bell but doesn't interact with the server.

Also: the old store had `unreadCount` as a function (`unreadCount()`). The new store has it as a plain number property. The `NotificationBell` component calls `unreadCount()` — this will be fixed in Task 15.

- [ ] **Step 2: Remove the old `Notification` type export**

The old store exports `type Notification`. The only importer is `NotificationBell.tsx` which will be updated in Task 15. Remove the `export interface Notification { ... }` from the old code (it's replaced by `ServerNotification` from api.ts).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/notifications.ts
git commit -m "feat: refactor notification store to sync with backend + SSE"
```

---

### Task 13: Mention Suggestion Component

**Files:**
- Create: `frontend/src/components/editor/MentionList.tsx`

- [ ] **Step 1: Create the mention suggestion dropdown**

```tsx
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'

interface MentionListProps {
  items: { id: string; name: string }[]
  command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => setSelectedIndex(0), [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) command({ id: item.id, label: item.name })
          return true
        }
        return false
      },
    }))

    if (!items.length) return null

    return (
      <div className="z-50 rounded-md border bg-popover p-1 shadow-md">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm ${
              index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
            }`}
            onClick={() => command({ id: item.id, label: item.name })}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold uppercase text-muted-foreground">
              {item.name.slice(0, 2)}
            </span>
            {item.name}
          </button>
        ))}
      </div>
    )
  },
)

MentionList.displayName = 'MentionList'
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/editor/MentionList.tsx
git commit -m "feat: add MentionList suggestion component for @mentions"
```

---

### Task 14: Integrate Mention Extension into TiptapEditor

**Files:**
- Modify: `frontend/src/components/editor/TiptapEditor.tsx`

- [ ] **Step 1: Add mention extension imports**

Add to imports:

```typescript
import Mention from '@tiptap/extension-mention'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { MentionList } from './MentionList'
import type { MentionListRef } from './MentionList'
import { useBoardStore } from '@/stores/board'
```

Check if `tippy.js` is already installed (it's a peer dependency of Tiptap). If not, install it.

- [ ] **Step 2: Create mention suggestion config**

Add a function that creates the mention suggestion config. It needs access to board members:

```typescript
function createMentionSuggestion(members: { id: string; name: string }[]) {
  return {
    items: ({ query }: { query: string }) =>
      members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5),
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null
      let popup: ReturnType<typeof tippy> | null = null
      return {
        onStart: (props: any) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor })
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          })
        },
        onUpdate: (props: any) => {
          component?.updateProps(props)
          popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
        },
        onKeyDown: (props: any) => component?.ref?.onKeyDown(props) ?? false,
        onExit: () => {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}
```

- [ ] **Step 3: Add Mention to editor extensions**

In the `useEditor` config, add the Mention extension to the extensions array. Gate it on `boardId` being available (not on `taskId`):

```typescript
const members = useBoardStore((s) => s.members)

// In the extensions array:
...(boardId
  ? [
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: createMentionSuggestion(
          members.map((m) => ({ id: m.id, name: m.name })),
        ),
      }),
    ]
  : []),
```

- [ ] **Step 4: Add mention CSS**

Add to the editor's CSS (or a global stylesheet):

```css
.mention {
  background-color: hsl(var(--accent));
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
  font-size: 0.875em;
  font-weight: 500;
}
```

Check where existing editor styles are defined and add there.

- [ ] **Step 5: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/TiptapEditor.tsx
git commit -m "feat: integrate @mention extension into TiptapEditor"
```

---

### Task 15: Refactor NotificationBell

**Files:**
- Modify: `frontend/src/components/notifications/NotificationBell.tsx`

- [ ] **Step 1: Update imports and types**

Replace the import:
```typescript
// Old:
import { useNotificationStore, type Notification } from '@/stores/notifications'
// New:
import { useNotificationStore } from '@/stores/notifications'
import type { ServerNotification } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
```

- [ ] **Step 2: Fix `unreadCount` usage**

The old store had `unreadCount` as a function: `const count = unreadCount()`. The new store has it as a plain number. Change:

```typescript
// Old:
const count = unreadCount()
// New — unreadCount is now a number, not a function:
const count = unreadCount
```

- [ ] **Step 3: Add SSE lifecycle and navigation**

Add SSE connect/disconnect and navigation:

```typescript
const navigate = useNavigate()
const { notifications, markRead, markAllRead, dismiss, unreadCount, fetch, connectSSE, disconnectSSE, fetchUnreadCount } =
  useNotificationStore()
const count = unreadCount

useEffect(() => {
  connectSSE()
  fetchUnreadCount()
  return () => disconnectSSE()
}, [])
```

- [ ] **Step 4: Update notification rendering**

Replace `notif.message` with `notif.title` and change `formatTimeAgo(notif.timestamp)` to use `created_at`:

```typescript
// Old:
{notif.message}
{formatTimeAgo(notif.timestamp)}
// New:
{notif.title}
{formatTimeAgo(new Date(notif.created_at).getTime())}
```

Update the type annotation in the map from `Notification` to `ServerNotification`:
```typescript
{notifications.map((notif: ServerNotification) => (
```

- [ ] **Step 5: Add click-to-navigate on notification items**

Wrap each notification row in a click handler that navigates to the relevant board:

```typescript
<div
  key={notif.id}
  onClick={() => {
    if (notif.board_id) navigate(`/boards/${notif.board_id}`)
    if (!notif.read) markRead(notif.id)
  }}
  className={cn(
    'group flex cursor-pointer items-start gap-2.5 border-b border-border/40 px-3 py-2.5 transition-colors last:border-0 hover:bg-accent/50',
    !notif.read && 'bg-accent/30',
  )}
>
```

- [ ] **Step 6: Fetch notifications on popover open**

Add an `onOpenChange` handler to the `Popover` that fetches when opened:

```typescript
<Popover onOpenChange={(open) => { if (open) fetch() }}>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/notifications/NotificationBell.tsx
git commit -m "feat: refactor NotificationBell to use server-backed notifications"
```

---

## Chunk 5: Verification

### Task 16: Full Stack Verification

- [ ] **Step 1: Run backend tests**

Run: `cargo test`
Expected: All tests pass.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy -- -D warnings`
Expected: No warnings.

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run frontend lint**

Run: `cd frontend && npx eslint src --ext .ts,.tsx`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/test issues from lot3a implementation"
```
