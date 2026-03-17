# Lot 4a — Duplicate Task & Board

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Duplicate task within a board, duplicate entire board with optional tasks

## Overview

Add the ability to duplicate individual tasks (with all related data) and entire boards. Reuses the UUID remapping pattern from the existing CLI export/import logic.

## 1. Backend — Duplicate Task

### Endpoint

```
POST /api/v1/boards/{board_id}/tasks/{task_id}/duplicate
```

Returns the newly created task with relations (labels, subtask_count, attachment_count) — same shape as `TaskWithRelations` used elsewhere in the API.

### Logic

Single SQLite transaction:

1. Read source task and verify it belongs to `board_id`, is not archived.
2. Shift positions: `UPDATE tasks SET position = position + 1 WHERE column_id = ? AND position > ? AND archived = 0` (where `?` is the source task's column_id and position).
3. Create new task with fresh UUID:
   - `title`: `"Copy of {original.title}"`
   - `description`, `priority`: copied as-is
   - `assignee`: NOT copied (set to None)
   - `due_date`: NOT copied (set to None)
   - `board_id`: same as original
   - `column_id`: same as original
   - `position`: original.position + 1
   - `archived`: false
4. Copy `task_labels`: for each label on the source task, create a link to the new task.
5. Copy `subtasks`: for each subtask, create a new one with fresh UUID, same title/position, `completed = false`.
6. Copy `field_values`: for each custom field value, create a copy linked to new task.
7. NOT copied: comments, attachments (these are user-generated content, not structural).

### Error cases

- Task not found or does not belong to `board_id`: 404.
- Source task is archived: 400 Bad Request.

### Db method

```rust
pub async fn duplicate_task(&self, task_id: &str, board_id: &str) -> anyhow::Result<TaskWithRelations>
```

Returns the new task with labels, subtask_count, and attachment_count (same `TaskWithRelations` struct used by task listing). Attachment count will be 0 since attachments are not copied.

### Activity log

Log action `"task_duplicated"` with details `{"source_task_id": "...", "title": "..."}`.

## 2. Backend — Duplicate Board

### Endpoint

```
POST /api/v1/boards/{board_id}/duplicate
```

**Request body:**

```json
{
  "name": "New Board Name",
  "include_tasks": true
}
```

Returns the newly created `Board`.

### Logic

Single SQLite transaction:

1. Read source board, verify user has at least Member role.
2. Create new board with fresh UUID and provided name.
3. Add calling user as Owner of new board.
4. Copy `columns`: fresh UUIDs, same name/position/wip_limit/color, skip archived columns.
5. Copy `labels`: fresh UUIDs, same name/color. Build old_label_id -> new_label_id map.
6. Copy `custom_fields`: fresh UUIDs, same name/field_type/config/position. Build old_field_id -> new_field_id map.
7. If `include_tasks`:
   - Copy non-archived `tasks`: fresh UUIDs, remap column_id via column map. Same title/description/priority/position. Clear assignee and due_date. Build old_task_id -> new_task_id map.
   - Copy `task_labels`: remap both task_id and label_id.
   - Copy `subtasks`: fresh UUIDs, remap task_id, reset completed=false.
   - Copy `field_values`: remap task_id and field_id.
8. NOT copied: comments, attachments, board members (only the creator becomes owner), notifications, archived items.

### Db method

```rust
pub async fn duplicate_board(
    &self,
    board_id: &str,
    new_name: &str,
    include_tasks: bool,
    owner_id: &str,
) -> anyhow::Result<Board>
```

### Activity log

Log action `"board_duplicated"` on the NEW board with details `{"source_board_id": "..."}`.

## 3. API Handlers

### `crates/server/src/api/tasks.rs`

```rust
pub async fn duplicate(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, task_id)): Path<(String, String)>,
) -> Result<Json<TaskWithRelations>, ApiError>
```

Requires Member role on the board.

### `crates/server/src/api/boards.rs`

```rust
#[derive(Deserialize)]
pub struct DuplicateBoard {
    pub name: String,
    pub include_tasks: Option<bool>,  // defaults to true
}

pub async fn duplicate(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path(board_id): Path<String>,
    Json(body): Json<DuplicateBoard>,
) -> Result<Json<Board>, ApiError>
```

Requires Member role on the source board. The `include_tasks` field defaults to `true` if not provided. Validates the board name using existing `validate_name` (non-empty, max length).

## 4. Routes

In `crates/server/src/api/mod.rs`, add to existing nested routers:

- **Task duplicate**: Add `.route("/duplicate", post(tasks::duplicate))` to the `task_item` router (which is already nested under `/{tid}`).
- **Board duplicate**: Add `.route("/duplicate", post(boards::duplicate))` to the `per_board` router (which is already nested under `/{id}`).

This follows the existing nesting pattern — no flat route strings needed.

## 5. MCP

In `crates/server/src/mcp/tools.rs`, add two new actions to `board_mutate`:

### `duplicate_task`

Required in `data`: `task_id`. The `board_id` is the standard top-level param of `board_mutate`.

### `duplicate_board`

Required in `data`: `name`. Optional: `include_tasks` (defaults to true). Creates the board and adds the MCP user as owner. Validates `name` with `validate_name`.

### MCP schema update

Add `"duplicate_task"` and `"duplicate_board"` to the `action` enum array in the `board_mutate` tool JSON schema in `mcp/sse.rs`, and add corresponding match arms in `handle_mutate()` in `mcp/tools.rs`.

## 6. Frontend

### API client (`frontend/src/lib/api.ts`)

Note: The frontend `Task` interface already includes optional `labels?`, `subtask_count?`, and `attachment_count?` fields, so it accommodates the `TaskWithRelations` shape from the backend.

```typescript
duplicateTask: (boardId: string, taskId: string) =>
  request<Task>(`/boards/${boardId}/tasks/${taskId}/duplicate`, { method: 'POST' }),

duplicateBoard: (boardId: string, data: { name: string; include_tasks?: boolean }) =>
  request<Board>(`/boards/${boardId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
```

### Task duplicate — TaskCard context menu

In the task card component (or wherever the task context menu is), add a "Duplicate" option with a Copy icon. On click:

1. Call `api.duplicateTask(boardId, taskId)`.
2. Refresh the board data (refetch tasks).
3. Show toast notification "Task duplicated".

### Board duplicate — UI

Add a "Duplicate board" option in the board settings or board header menu. On click, show a dialog:

- Text input: board name (pre-filled with "Copy of {currentBoard.name}").
- Checkbox: "Include tasks" (checked by default).
- Confirm / Cancel buttons.

On confirm:

1. Call `api.duplicateBoard(boardId, { name, include_tasks })`.
2. Navigate to the new board (`window.location.hash = '#/boards/${newBoard.id}'`).
3. Refresh the board list in the sidebar/dashboard.

## 7. Files Modified

| File | Change |
|------|--------|
| `crates/server/src/db/repo.rs` | `duplicate_task`, `duplicate_board` methods |
| `crates/server/src/api/tasks.rs` | `duplicate` handler |
| `crates/server/src/api/boards.rs` | `DuplicateBoard` struct, `duplicate` handler |
| `crates/server/src/api/mod.rs` | Add routes |
| `crates/server/src/mcp/tools.rs` | `duplicate_task`, `duplicate_board` actions |
| `crates/server/src/mcp/sse.rs` | Add actions to `board_mutate` tool schema enum |
| `frontend/src/lib/api.ts` | `duplicateTask`, `duplicateBoard` methods |
| `frontend/src/components/board/TaskCard.tsx` (or context menu component) | "Duplicate" menu item |
| Board settings or header component | "Duplicate board" option + dialog |

**Total:** 9 files modified, 0 new.

## Out of Scope

- Duplicate to a different board (only same-board for tasks)
- Duplicate archived tasks or columns
- Copy comments or attachments
- Copy board members or notifications
- Bulk duplicate (multiple tasks at once)

## Success Criteria

1. Duplicate task creates a new task with "Copy of" prefix, same labels/subtasks/field values, in the same column.
2. Subtasks are reset to uncompleted.
3. Assignee and due_date are cleared on duplicated tasks.
4. Duplicate board creates a complete copy with columns, labels, custom fields.
5. When include_tasks=true, tasks are copied with their labels, subtasks, and field values.
6. Archived items are not copied.
7. The duplicating user becomes Owner of the new board.
8. Both operations are available via REST API and MCP.
9. Frontend provides intuitive UX for both operations.
