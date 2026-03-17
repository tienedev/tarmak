# Lot 3a — Notifications & Mentions

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Persistent notifications, SSE delivery, automatic triggers, @mentions in comments

## Overview

Add a server-backed notification system. Notifications are created automatically when meaningful events occur (assignment, comment, mention, deadline). Delivered in real-time via SSE, with REST polling fallback. @mentions in comments use Tiptap's mention extension.

## 1. Database

### v8 Migration

```sql
CREATE TABLE notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,  -- 'mention' | 'assignment' | 'deadline' | 'comment'
    title      TEXT NOT NULL,
    body       TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read, created_at);
```

No FTS5 index needed — notifications are queried by user_id, not searched.

## 2. Backend — Notification Service

### Module: `crates/server/src/notifications.rs` (new)

Central notification service with two responsibilities:

1. **In-process broadcast** — A `tokio::broadcast::Sender<(String, Notification)>` shared via app state. When a notification is created, it's sent on this channel. SSE connections subscribe and filter by `user_id`.

2. **Mention parser** — Extract user IDs from Tiptap HTML. Tiptap's mention extension renders:
   ```html
   <span data-type="mention" data-id="USER_ID" class="mention">@Name</span>
   ```
   The parser uses a simple regex on `data-id` attributes within mention spans. No full HTML parser needed.

### Db methods (`crates/server/src/db/repo.rs`)

```rust
/// Create a notification and return it.
pub async fn create_notification(&self, user_id: &str, board_id: &str, task_id: Option<&str>,
    notif_type: &str, title: &str, body: Option<&str>) -> anyhow::Result<Notification>

/// List notifications for a user, newest first. Optional unread_only filter.
pub async fn list_notifications(&self, user_id: &str, unread_only: bool,
    limit: i64, offset: i64) -> anyhow::Result<Vec<Notification>>

/// Count unread notifications for a user.
pub async fn unread_notification_count(&self, user_id: &str) -> anyhow::Result<i64>

/// Mark a single notification as read. Returns true if updated.
pub async fn mark_notification_read(&self, notification_id: &str, user_id: &str) -> anyhow::Result<bool>

/// Mark all notifications as read for a user.
pub async fn mark_all_notifications_read(&self, user_id: &str) -> anyhow::Result<u64>
```

The `mark_notification_read` method takes `user_id` to ensure a user can only mark their own notifications.

### Notification model (`crates/server/src/db/models.rs`)

```rust
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    pub r#type: String,
    pub title: String,
    pub body: Option<String>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}
```

## 3. Backend — API

### REST endpoints

All endpoints require authentication (JWT via `AuthUser` middleware). No board-level permissions — notifications are per-user.

#### List notifications

```
GET /api/v1/notifications?unread_only=false&limit=50&offset=0
```

Returns `Vec<Notification>`, newest first.

#### Unread count

```
GET /api/v1/notifications/unread-count
```

Returns `{ "count": N }`.

#### Mark one as read

```
PATCH /api/v1/notifications/{id}/read
```

Returns `{ "ok": true }`. 404 if notification doesn't belong to the user.

#### Mark all as read

```
PATCH /api/v1/notifications/read-all
```

Returns `{ "updated": N }`.

### SSE endpoint

```
GET /api/v1/notifications/stream
```

Requires authentication via `Authorization: Bearer <token>` header or `?token=` query param (for EventSource which doesn't support headers).

The handler:
1. Authenticates the user
2. Subscribes to the broadcast channel
3. Sends `event: connected\ndata: {}\n\n` immediately
4. For each notification on the broadcast channel where `user_id` matches, sends:
   ```
   event: notification
   data: <JSON Notification>
   ```
5. Sends `event: ping\ndata: {}\n\n` every 30 seconds as keepalive

On client disconnect, the subscription is dropped automatically (Rust ownership).

### Routing (`crates/server/src/api/mod.rs`)

```rust
let notifications = Router::new()
    .route("/", get(notifications::list))
    .route("/unread-count", get(notifications::unread_count))
    .route("/read-all", patch(notifications::mark_all_read))
    .route("/{id}/read", patch(notifications::mark_read))
    .route("/stream", get(notifications::stream));

// Add under /api/v1
.nest("/notifications", notifications)
```

## 4. Triggers

Notifications are created directly in the existing API handlers — no event bus.

### Assignment trigger (`crates/server/src/api/tasks.rs`)

In the `update` handler, when `assignee` changes:
- If the new assignee is a valid user and not the current user
- Create notification: type=`assignment`, title=`"You were assigned to \"{task.title}\""`, with board_id and task_id
- Send on broadcast channel

### Comment trigger (`crates/server/src/api/comments.rs`)

In the `create` handler, after creating the comment:
- Fetch board members
- For each member who is NOT the comment author:
  - Create notification: type=`comment`, title=`"{user.name} commented on \"{task.title}\""`, with board_id and task_id
- Send on broadcast channel

### Mention trigger (`crates/server/src/api/comments.rs`)

In the `create` and `update` handlers:
- Parse mention spans from the comment HTML content using the mention parser
- For each mentioned user_id that is NOT the comment author:
  - Create notification: type=`mention`, title=`"{user.name} mentioned you in \"{task.title}\""`, with board_id and task_id
- Mention notifications replace the generic comment notification for that user (don't send both)

### Deadline trigger (`crates/server/src/background.rs`)

Background task running every hour (tokio interval):
1. Query tasks with `due_date` between now and now+24h that have an assignee
2. Check if a `deadline` notification already exists for that task+user (avoid duplicates)
3. Create notification: type=`deadline`, title=`"Task \"{task.title}\" is due tomorrow"`, with board_id and task_id
4. Send on broadcast channel

### MCP triggers (`crates/server/src/mcp/tools.rs`)

The `board_mutate` handler should also trigger notifications for assignment changes and new comments, following the same logic as the API handlers. Extract the trigger logic into shared functions in `notifications.rs` to avoid duplication.

## 5. Frontend — Mention Extension

### Package

Add `@tiptap/extension-mention` to `frontend/package.json`.

### TiptapEditor changes (`frontend/src/components/editor/TiptapEditor.tsx`)

- Import and configure the Mention extension
- Provide a `suggestion` config that:
  - On `@` keystroke, shows a popup with board members
  - Fetches members from the board store (already loaded)
  - Renders a dropdown list with member names
  - On select, inserts `<span data-type="mention" data-id="USER_ID">@Name</span>`
- The mention extension needs `boardId` to know which board's members to suggest — this prop already exists on TiptapEditor

### Mention suggestion component (`frontend/src/components/editor/MentionList.tsx`, new)

A small React component for the suggestion dropdown:
- Receives `items` (filtered member list) and `command` (insert function)
- Renders a list of member names with keyboard navigation (up/down/enter)
- Styling consistent with existing shadcn/ui patterns

### Mention display styling

Add CSS for `.mention` class — inline badge-like styling (background color, rounded, slightly smaller text) so mentions are visually distinct in rendered comments.

## 6. Frontend — Notification Store & UI

### Store refactor (`frontend/src/stores/notifications.ts`)

Replace the client-only store with a backend-synced version:

```typescript
interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  // Actions
  fetch(): Promise<void>          // GET /notifications
  fetchUnreadCount(): Promise<void> // GET /notifications/unread-count
  markRead(id: string): Promise<void>
  markAllRead(): Promise<void>
  connectSSE(): void               // Start SSE connection
  disconnectSSE(): void            // Stop SSE connection
}
```

The SSE connection:
- Opens on login / app init (when token is available)
- Closes on logout
- On `notification` event: prepend to list, increment unreadCount
- On disconnect: auto-reconnect via EventSource retry (built-in)
- Fallback: if SSE not available, poll `/notifications/unread-count` every 30 seconds

### NotificationBell refactor (`frontend/src/components/notifications/NotificationBell.tsx`)

- Use the refactored store instead of the client-only one
- Fetch notifications on popover open
- Badge shows `unreadCount` from store
- Click on a notification → `router.push(/boards/{board_id})` and open the task if task_id is set
- Keep existing UI structure (popover, scroll area, mark as read, dismiss)

### API client (`frontend/src/lib/api.ts`)

Add notification methods and type:

```typescript
export interface Notification {
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

listNotifications(params?: { unread_only?: boolean; limit?: number; offset?: number }): Promise<Notification[]>
getUnreadCount(): Promise<{ count: number }>
markNotificationRead(id: string): Promise<{ ok: boolean }>
markAllNotificationsRead(): Promise<{ updated: number }>
```

## 7. Main wiring (`crates/server/src/main.rs`)

- Create the broadcast channel at startup: `tokio::broadcast::channel::<(String, Notification)>(256)`
- Pass the `Sender` into app state (accessible by handlers and background tasks)
- Spawn the deadline background task

## Files Modified

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | v8 migration (notifications table + index) |
| `crates/server/src/db/models.rs` | `Notification` struct |
| `crates/server/src/db/repo.rs` | Notification CRUD methods |
| `crates/server/src/notifications.rs` | **New** — broadcast channel type, mention parser, shared trigger helpers |
| `crates/server/src/api/notifications.rs` | **New** — REST + SSE handlers |
| `crates/server/src/api/mod.rs` | Notification routes |
| `crates/server/src/api/tasks.rs` | Assignment trigger |
| `crates/server/src/api/comments.rs` | Comment + mention triggers |
| `crates/server/src/background.rs` | Deadline check background task |
| `crates/server/src/main.rs` | Wire broadcast channel + deadline task |
| `crates/server/src/mcp/tools.rs` | Notification triggers in board_mutate |
| `frontend/package.json` | Add `@tiptap/extension-mention` |
| `frontend/src/lib/api.ts` | Notification type + API methods |
| `frontend/src/stores/notifications.ts` | Refactor to backend-synced store + SSE |
| `frontend/src/components/notifications/NotificationBell.tsx` | Use real data, navigation |
| `frontend/src/components/editor/TiptapEditor.tsx` | Mention extension integration |
| `frontend/src/components/editor/MentionList.tsx` | **New** — suggestion dropdown component |

**Total:** 17 files (14 modified, 3 new).

## Out of Scope

- Email/push notification delivery (SSE + polling only)
- Notification preferences/settings (all notifications enabled for all users)
- Notification grouping/batching (each event = one notification)
- @mention in task descriptions (comments only)
- Delete/archive notifications (mark as read only)

## Success Criteria

1. Assignment change creates notification for the assignee
2. New comment creates notifications for board members
3. @mention in comment creates targeted mention notification (replaces generic comment notif for that user)
4. Tasks due within 24h generate deadline notification for assignee (no duplicates)
5. SSE stream delivers notifications in real-time
6. Polling fallback works when SSE is unavailable
7. NotificationBell shows correct unread count from server
8. Clicking a notification navigates to the relevant board/task
9. Mark as read and mark all as read persist to server
10. @mention autocomplete works in comment editor with board members
