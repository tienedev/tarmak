# Lot 3 Design — Command Palette, Archive, WIP Limits UI, File Attachments

**Date**: 2026-03-15
**Status**: Approved
**Scope**: MVP polish — UX features that bring Kanwise to parity with modern kanban tools

---

## Overview

Four features to make Kanwise feel production-ready:

1. **Command palette + keyboard shortcuts** — Cmd+K palette with `cmdk`, global hotkeys
2. **Archive** — soft-delete for tasks and columns, with cascade and restore
3. **WIP limits UI** — editable limit in column header (backend already exists)
4. **File attachments** — inline in Tiptap editor, filesystem storage on VPS

---

## 1. Command Palette + Keyboard Shortcuts

### Library

`cmdk` is already installed (`1.1.1`) and shadcn `Command` primitives exist in `frontend/src/components/ui/command.tsx`. The palette builds on top of these existing components.

### Activation

`Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) opens a centered overlay dialog with a search input.

### Actions

| Action | Direct shortcut | Category |
|--------|----------------|----------|
| Create task | `n` | Tasks |
| Focus search | `/` | Navigation |
| Kanban view | `1` | Views |
| List view | `2` | Views |
| Timeline view | `3` | Views |
| Close dialog/palette | `Esc` | Global |
| Open activity panel | `a` | Board |
| Show keyboard shortcuts | `?` | Help |

### Behavior

- Direct shortcuts (`n`, `/`, `1`, `2`, `3`, `a`, `?`) fire only when no input/textarea/contenteditable has focus
- `Cmd+K` / `Ctrl+K` works regardless of focus (always opens palette)
- Palette filters actions in real-time as user types
- Each action shows: icon (Lucide) + label + shortcut badge on the right
- Palette closes after executing an action or pressing Escape
- `?` opens a help dialog listing all available shortcuts

### Files

| File | Change |
|------|--------|
| `frontend/src/components/CommandPalette.tsx` | **New** — palette built on existing `components/ui/command.tsx` (shadcn cmdk wrapper) |
| `frontend/src/components/ShortcutsDialog.tsx` | **New** — help dialog listing all available shortcuts |
| `frontend/src/hooks/useHotkeys.ts` | **New** — global keyboard shortcut hook |
| `frontend/src/pages/BoardPage.tsx` | Mount CommandPalette + useHotkeys (board-scoped, not app-level since most actions are board-specific) |

---

## 2. Archive (Tasks + Columns)

### Data Model — Migration v6

```sql
ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE columns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
```

### Behavior

- **Archive a task**: sets `archived = 1`, card disappears from board views
- **Archive a column**: sets `archived = 1` on the column AND all its tasks
- **Unarchive a column**: restores the column and ALL tasks that were in it (including tasks that were individually archived before the column — no distinction is tracked between cascade-archived and individually-archived)
- **Unarchive a task**: restores the task to its original column. If that column is archived, places the task in the first active column
- **Board views**: filter out archived items at SQL level (`WHERE archived = 0`)
- **Search**: by default excludes archived items. A toggle "Include archives" (off by default) in the SearchBar includes them — archived results display a gray "Archived" badge. Clicking opens TaskDialog with "Restore" button visible
- **Archive panel**: accessible from board header, lists archived tasks and columns with restore buttons

### Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/boards/:id/tasks/:tid/archive` | Archive a task |
| POST | `/boards/:id/tasks/:tid/unarchive` | Unarchive a task |
| POST | `/boards/:id/columns/:cid/archive` | Archive column + all its tasks |
| POST | `/boards/:id/columns/:cid/unarchive` | Unarchive column + all its tasks |
| GET | `/boards/:id/archive` | List archived items (tasks + columns) |

**Permissions:** All archive/unarchive operations require `Role::Member` or above. `Role::Viewer` cannot archive or unarchive.

### Rust model changes

```rust
// Task struct gains:
pub archived: bool,

// Column struct gains:
pub archived: bool,
```

### Repo changes

- All task/column list queries gain `AND archived = 0` (except the archive listing endpoint)
- `archive_task(task_id)` — sets `archived = 1`
- `unarchive_task(task_id)` — sets `archived = 0`, checks column is active
- `archive_column(column_id)` — sets `archived = 1` on column + `UPDATE tasks SET archived = 1 WHERE column_id = ?`
- `unarchive_column(column_id)` — sets `archived = 0` on column + its tasks
- `list_archived(board_id)` — returns archived tasks and columns

### Search changes

- `search_board()` in `repo.rs` gains an optional `include_archived: bool` parameter (default false)
- When false: `AND task_id IN (SELECT id FROM tasks WHERE archived = 0)` filter on search_index join
- API endpoint `GET /boards/:id/search` gains `?include_archived=true` query param
- Frontend SearchBar adds a toggle button

### MCP — New `board_mutate` actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `archive_task` | `{ board_id, task_id }` | Archive a task |
| `unarchive_task` | `{ board_id, task_id }` | Restore a task |
| `archive_column` | `{ board_id, column_id }` | Archive column + tasks |
| `unarchive_column` | `{ board_id, column_id }` | Restore column + tasks |

### `board_query` changes

- `tasks` and `full` scopes: exclude archived by default
- New optional param `include_archived: Option<bool>` on `BoardQueryParams`
- The MCP stdio tool definition `inputSchema` for `board_query` in `main.rs` must also be updated with the new `include_archived` property

### `board_ask` changes

New keyword pattern: `"archived"`, `"archives"` → returns list of archived tasks.

**Important:** All existing `board_ask` queries (overdue, unassigned, stale, stats, high priority, etc.) must gain `AND archived = 0` to exclude archived tasks from their results.

### Activity logging

| Action | Details JSON |
|--------|-------------|
| `task_archived` | `{ "task_title": "..." }` |
| `task_unarchived` | `{ "task_title": "..." }` |
| `column_archived` | `{ "column_name": "...", "task_count": N }` |
| `column_unarchived` | `{ "column_name": "...", "task_count": N }` |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/lib/api.ts` | Add archive/unarchive API methods; add `archived` to Task/Column types |
| `frontend/src/stores/board.ts` | Add archive/unarchive store methods |
| `frontend/src/components/board/TaskEditor.tsx` | Add "Archive" button in footer next to "Delete" |
| `frontend/src/components/board/KanbanColumn.tsx` | Add "Archive column" in column context menu |
| `frontend/src/components/board/ArchivePanel.tsx` | **New** — side panel listing archived items with restore buttons |
| `frontend/src/components/board/SearchBar.tsx` | Add "Include archives" toggle, gray "Archived" badge on results |
| `frontend/src/pages/BoardPage.tsx` | Add "Archives" button in header, wire ArchivePanel |

---

## 3. WIP Limits UI

### What already exists

- DB: `columns.wip_limit` (nullable integer)
- API: `PUT /boards/:id/columns/:cid` accepts `wip_limit`
- MCP: `update_column` action supports `wip_limit`
- Frontend: `KanbanColumn.tsx` displays task count, limit, and warning badge when at/over limit

### What's needed

A popover in the column header to edit the WIP limit:

- Click on the task counter (`3` or `3/5`) → opens a small popover
- Popover contains: label "WIP Limit" + number input
- Empty or 0 = no limit
- Saves on blur or Enter via existing `update_column` API
- No new endpoints, no migration

### Files

| File | Change |
|------|--------|
| `frontend/src/components/board/KanbanColumn.tsx` | Add popover with number input on task counter click |

---

## 4. File Attachments

### Data Model — Migration v6 (combined with archive)

```sql
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
```

### Filesystem Storage

- Directory configurable via `KANBAN_UPLOADS_DIR` env var (default: `./uploads/`)
- Structure: `uploads/{board_id}/{task_id}/{uuid}_{filename}`
- Max file size: 10MB (configurable via `KANBAN_MAX_UPLOAD_SIZE`)
- Files served via API endpoint, not as static files

### Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/boards/:id/tasks/:tid/attachments` | Upload file (multipart/form-data) |
| GET | `/boards/:id/tasks/:tid/attachments` | List attachments for a task |
| GET | `/boards/:id/attachments/:aid/download` | Download file (streams from disk, board membership verified via route nesting) |
| DELETE | `/boards/:id/tasks/:tid/attachments/:aid` | Delete file from disk + DB |

### Rust types

```rust
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

### Upload flow

1. Frontend drops file in Tiptap editor
2. Drop handler fires → `POST /boards/:id/tasks/:tid/attachments` (multipart)
3. Backend: validates size/type → writes to `uploads/{board_id}/{task_id}/{uuid}_{filename}` → inserts DB row → returns `Attachment` JSON (including `id` for download URL)
4. Frontend: receives response → inserts Tiptap node:
   - Image (`image/*`): `Image` node with `src="/api/v1/boards/{board_id}/attachments/{id}/download"`
   - Other: custom `FileBlock` node (icon + filename + size + download link)

### Tiptap Integration

**Extensions needed:**

- `@tiptap/extension-image` — for inline images with drag/resize
- Custom `FileBlock` node extension — for non-image files (renders as a card: type icon + filename + size + download link)
- Custom drop handler plugin — intercepts file drops, uploads, inserts the correct node

**Behavior:**
- Drag & drop a file anywhere in the editor → uploads and inserts at drop position
- Images display inline with preview
- Non-image files display as a styled card block
- Nodes are draggable within the editor to reposition
- Deleting a node from the editor removes the visual reference; the file remains on disk (cleanup is a background concern, not MVP)

### MCP

| Tool | Change |
|------|--------|
| `board_query` | New scope `"attachments"` (requires `task_id`) — returns list of attachments in KBF or JSON |
| `board_mutate` | New action `delete_attachment` with `{ board_id, attachment_id }` |

No upload via MCP (multipart doesn't fit the MCP protocol).

### KBF format

```
#attachment@v1:id,task_id,filename,mime,size
att1|t1|screenshot.png|image/png|245000
att2|t1|report.pdf|application/pdf|1200000
```

### TaskCard indicator

- Bottom of card: paperclip icon + count (from a `attachment_count` field added to `TaskWithRelations`)
- Count derived via batch loading: `get_attachment_counts_for_board(board_id)` method (same pattern as existing `get_subtask_counts_for_board`), to avoid N+1 queries

### Activity logging

| Action | Details JSON |
|--------|-------------|
| `attachment_added` | `{ "task_title": "...", "filename": "...", "size_bytes": N }` |
| `attachment_deleted` | `{ "task_title": "...", "filename": "..." }` |

### Files

#### Backend

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | Add v6: archive columns + attachments table |
| `crates/server/src/db/models.rs` | Add `Attachment` struct; add `archived` to Task and Column; add `attachment_count` to `TaskWithRelations` |
| `crates/server/src/db/repo.rs` | Add attachment CRUD; add archive/unarchive methods; update task/column queries for archived filter; add attachment_count to task queries |
| `crates/server/src/api/mod.rs` | Register attachment and archive routes |
| `crates/server/src/api/attachments.rs` | **New** — upload, list, download, delete handlers |
| `crates/server/src/api/archive.rs` | **New** — archive/unarchive/list handlers |
| `crates/server/src/api/tasks.rs` | Update to exclude archived tasks by default |
| `crates/server/src/api/columns.rs` | Update to exclude archived columns by default |
| `crates/server/src/api/search.rs` | Add `include_archived` query param |
| `crates/server/src/mcp/tools.rs` | Add archive actions, attachment scope/actions |
| `crates/server/src/mcp/board_ask.rs` | Add "archived" keyword pattern |
| `crates/server/src/mcp/kbf_bridge.rs` | Add attachment KBF encoding |
| `crates/server/src/main.rs` | Configure uploads directory, max upload size |
| `crates/server/Cargo.toml` | Enable `axum` `multipart` feature (or add `axum-extra` with multipart) for file upload parsing |

#### Frontend

| File | Change |
|------|--------|
| `frontend/src/lib/api.ts` | Add Attachment type; add attachment/archive API methods; add `archived` to types. Upload method must use `FormData` without `Content-Type: application/json` (let browser set multipart boundary) |
| `frontend/src/stores/board.ts` | Add archive/unarchive methods |
| `frontend/src/components/editor/TiptapEditor.tsx` | Add Image extension, FileBlock custom node, drop handler plugin |
| `frontend/src/components/editor/FileBlockNode.tsx` | **New** — custom Tiptap node component for non-image files |
| `frontend/src/components/board/TaskCard.tsx` | Add paperclip + attachment count |
| `frontend/src/components/board/TaskEditor.tsx` | Add "Archive" button in footer |
| `frontend/src/components/board/KanbanColumn.tsx` | Add "Archive column" in context menu; add WIP limit edit popover |
| `frontend/src/components/board/ArchivePanel.tsx` | **New** — archived items panel with restore |
| `frontend/src/components/board/SearchBar.tsx` | Add "Include archives" toggle |
| `frontend/src/components/CommandPalette.tsx` | **New** — cmdk palette |
| `frontend/src/hooks/useHotkeys.ts` | **New** — global keyboard shortcuts |
| `frontend/src/pages/BoardPage.tsx` | Wire ArchivePanel, Archives button |
| `frontend/package.json` | Add `@tiptap/extension-image` (`cmdk` already installed) |

---

## Non-goals

- No file versioning (upload replaces, no history)
- No image editing/cropping in editor
- No attachment preview modal (click = download)
- No bulk archive operations (one at a time)
- No archive expiry/auto-delete
- No WIP limit hard-block on drag-drop (soft warning only)
- No custom keyboard shortcut configuration
- No upload via MCP
- No file type restrictions beyond size limit
- No real-time WebSocket notification for archive/attachment changes (other clients refresh on next fetch)
- No CSP changes needed — attachment URLs are same-origin (`img-src 'self'` covers it)
