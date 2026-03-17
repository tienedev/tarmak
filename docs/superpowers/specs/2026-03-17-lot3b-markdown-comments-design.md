# Lot 3b — Rich Text Comments

**Date**: 2026-03-17
**Status**: Draft
**Scope**: Replace plain-text comments with Tiptap rich text editor, add edit/delete

## Overview

Upgrade the comment system from plain-text input to the same Tiptap rich text editor already used for task descriptions. Add edit and delete capabilities (author-only). Store content as HTML.

## 1. Database

### v7 Migration

Add `updated_at` column to the `comments` table:

```sql
ALTER TABLE comments ADD COLUMN updated_at TEXT;

-- FTS5 search index: add UPDATE trigger (v5 only created INSERT/DELETE triggers)
CREATE TRIGGER IF NOT EXISTS search_idx_comment_update AFTER UPDATE ON comments BEGIN
    DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('comment', NEW.id,
        (SELECT board_id FROM tasks WHERE id = NEW.task_id),
        NEW.task_id, NEW.content);
END;
```

No data migration needed — existing comments keep `updated_at = NULL`, meaning "never edited". The `content` column already stores `TEXT`, so switching from plain text to HTML requires no schema change. Existing plain-text comments render correctly since plain text is valid HTML.

## 2. Backend API

### Existing endpoints (unchanged)

- `GET /boards/{board_id}/tasks/{tid}/comments` — returns `Vec<Comment>`
- `POST /boards/{board_id}/tasks/{tid}/comments` — creates a comment

### Comment model update

Add `updated_at` to the `Comment` struct:

```rust
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,  // NEW
}
```

All queries that SELECT from `comments` must include the new column.

### New: Update comment

```
PUT /boards/{board_id}/tasks/{tid}/comments/{comment_id}
```

**Request body:** `{ "content": "<p>Updated HTML</p>" }`

**Behavior:**
1. Require `Role::Member` on the board
2. Fetch the comment — 404 if not found
3. Verify `comment.user_id == auth_user.id` — 403 if not the author
4. Update `content` and `updated_at`
5. Log activity as `comment_updated`
6. Return the updated `Comment`

### New: Delete comment

```
DELETE /boards/{board_id}/tasks/{tid}/comments/{comment_id}
```

**Behavior:**
1. Require `Role::Member` on the board
2. Fetch the comment — 404 if not found
3. Verify `comment.user_id == auth_user.id` — 403 if not the author
4. Delete the comment
5. Log activity as `comment_deleted`
6. Return `Json({"deleted": true})` with 200 (matching existing delete patterns)

### New Db methods

```rust
/// Get a single comment by ID.
pub async fn get_comment(&self, comment_id: &str) -> anyhow::Result<Option<Comment>>

/// Update comment content. Returns the updated comment.
pub async fn update_comment(&self, comment_id: &str, content: &str) -> anyhow::Result<Option<Comment>>

/// Delete a comment. Returns true if a row was deleted.
pub async fn delete_comment(&self, comment_id: &str) -> anyhow::Result<bool>
```

Ownership check (`user_id == auth_user.id`) happens in the API handler, not in the Db method — consistent with how other entities handle authorization.

### Updated queries

`list_comments`, `get_comments_for_board`, and `get_comment` must include `updated_at` in their SELECT. The `create_comment` SQL INSERT stays the same, but its Rust struct construction must add `updated_at: None`.

### Routing

Add a new route for comment item operations in `api/mod.rs`:

```rust
.route("/comments", get(comments::list).post(comments::create))
.route("/comments/{cid}", put(comments::update).delete(comments::delete))
```

## 3. Frontend

### Comment input

Replace the plain `<Input>` in `TaskEditor.tsx` with `<TiptapEditor>`:

- Same component and config as task descriptions (bold, italic, lists, code blocks, images)
- Placeholder text: "Write a comment..."
- Submit button below the editor (not on Enter — Enter creates a newline in the editor)
- On submit: serialize editor HTML via `editor.getHTML()`, POST to API, clear editor
- Image uploads in comments use the same attachment upload flow as descriptions

### Comment display

Replace `<p className="text-sm">{comment.content}</p>` with a `<div>` rendering the HTML content. Use a `prose` class for consistent typography styling, consistent with how descriptions are displayed.

### Edit mode

- Show an edit icon (pencil) on comments where `comment.user_id === currentUser.id`
- On click: replace the display with a `<TiptapEditor>` pre-filled with `comment.content`
- Save and Cancel buttons below
- On save: PUT to API, update local state, exit edit mode
- Show "(edited)" indicator next to timestamp when `updated_at` is not null

### Delete

- Show a delete icon (trash) on comments where `comment.user_id === currentUser.id`
- Confirmation dialog before deleting
- On confirm: DELETE to API, remove from local state

### API client

Add to the existing API module:

```typescript
updateComment(boardId: string, taskId: string, commentId: string, content: string): Promise<Comment>
deleteComment(boardId: string, taskId: string, commentId: string): Promise<{ deleted: boolean }>
```

### TypeScript Comment type

Add `updated_at` to the `Comment` interface in `api.ts`:

```typescript
interface Comment {
    // ... existing fields ...
    updated_at: string | null;  // NEW
}
```

## 4. Activity logging

New activity actions:
- `comment_updated` — details: `{"task_id": "...", "comment_id": "..."}`
- `comment_deleted` — details: `{"task_id": "...", "comment_id": "..."}`

These appear in the existing ActivityPanel with appropriate icons/labels.

## Files Modified

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | Add v7 migration (`ALTER TABLE comments ADD COLUMN updated_at` + FTS5 update trigger) |
| `crates/server/src/db/models.rs` | Add `updated_at: Option<DateTime<Utc>>` to `Comment` |
| `crates/server/src/db/repo.rs` | Add `get_comment`, `update_comment`, `delete_comment`; update all comment SELECTs to include `updated_at` |
| `crates/server/src/api/comments.rs` | Add `update` and `delete` handlers |
| `crates/server/src/api/mod.rs` | Add `.route("/comments/{cid}", put(...).delete(...))` |
| `crates/server/src/cli.rs` | Update `ExportedComment` to include `updated_at`; update import INSERT to write `updated_at` |
| `crates/server/src/mcp/tools.rs` | Add `update_comment` and `delete_comment` actions to `board_mutate` |
| `frontend/src/components/board/TaskEditor.tsx` | Replace Input with TiptapEditor for comment input; render HTML for display; add edit/delete UI |
| `frontend/src/lib/api.ts` | Add `updated_at` to `Comment` type; add `updateComment`, `deleteComment` methods |

**Total:** 9 files modified, 0 new files.

## Out of Scope

- @mentions in comments (Lot 3a — Notifications)
- Real-time comment updates via WebSocket (Lot 3a — Notifications)
- Comment reactions/emoji
- Comment threading/replies
- Migrating existing plain-text comments to HTML (they render fine as-is)

## Success Criteria

1. Comments accept rich text (bold, italic, lists, code, images)
2. Rich text comments render correctly with proper typography
3. Authors can edit their own comments (content updates, "edited" indicator shown)
4. Authors can delete their own comments (with confirmation)
5. Non-authors cannot edit or delete others' comments (403)
6. Existing plain-text comments display correctly without migration
7. Export/import handles the new `updated_at` field
8. All existing tests pass after migration
