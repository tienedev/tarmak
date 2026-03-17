# Lot 3b — Rich Text Comments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text comments with Tiptap rich text editor, add edit/delete capabilities (author-only), store content as HTML.

**Architecture:** v7 migration adds `updated_at` column + FTS5 update trigger. New PUT/DELETE API endpoints with author-only authorization. Frontend swaps `<Input>` for the existing `<TiptapEditor>` component and adds inline edit/delete UI.

**Tech Stack:** Rust (Axum, rusqlite), React, TypeScript, Tiptap v3, Zustand

**Spec:** `docs/superpowers/specs/2026-03-17-lot3b-markdown-comments-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | Add v7 migration (`ALTER TABLE comments ADD COLUMN updated_at` + FTS5 update trigger) |
| `crates/server/src/db/models.rs` | Add `updated_at: Option<DateTime<Utc>>` to `Comment` |
| `crates/server/src/db/repo.rs` | Add `get_comment`, `update_comment`, `delete_comment`; update all comment SELECTs to include `updated_at` |
| `crates/server/src/api/comments.rs` | Add `update` and `delete` handlers |
| `crates/server/src/api/mod.rs` | Add `.route("/comments/{cid}", put(...).delete(...))` |
| `crates/server/src/cli.rs` | Update `ExportedComment` to include `updated_at`; update import INSERT to write `updated_at` |
| `crates/server/src/mcp/tools.rs` | Add `update_comment` and `delete_comment` actions to `board_mutate` |
| `crates/server/src/mcp/sse.rs` | Add `update_comment`, `delete_comment` to `board_mutate` action enum in JSON schema |
| `frontend/src/lib/api.ts` | Add `updated_at` to `Comment` type; add `updateComment`, `deleteComment` methods |
| `frontend/src/components/board/TaskEditor.tsx` | Replace Input with TiptapEditor for comment input; render HTML for display; add edit/delete UI |

**Total:** 10 files modified, 0 new files.

---

## Chunk 1: Backend — Database Layer

### Task 1: v7 Migration

**Files:**
- Modify: `crates/server/src/db/migrations.rs`

- [ ] **Step 1: Add v7 migration function**

Add after the `v6()` function (after line ~429):

```rust
fn v7(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "ALTER TABLE comments ADD COLUMN updated_at TEXT;

         CREATE TRIGGER IF NOT EXISTS search_idx_comment_update AFTER UPDATE ON comments BEGIN
             DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
             INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
             VALUES ('comment', NEW.id,
                 (SELECT board_id FROM tasks WHERE id = NEW.task_id),
                 NEW.task_id, NEW.content);
         END;

         INSERT INTO schema_version (version) VALUES (7);",
    )?;
    tx.commit()?;
    Ok(())
}
```

- [ ] **Step 2: Wire v7 into `run_migrations`**

In `run_migrations()`, add after `if current < 6 { v6(conn)... }`:

```rust
if current < 6 { v6(conn).context("applying migration v6")?; }
if current < 7 { v7(conn).context("applying migration v7")?; }
```

- [ ] **Step 3: Update migration tests**

There are **three** tests that assert `ver == 6` — all must be updated to `7`:
1. `test_migrations_apply_cleanly` (~line 448): `assert_eq!(ver, 7, "should be at version 7");`
2. `test_migrations_are_idempotent` (~line 489-500): same assertion
3. `test_migration_v2_applies_cleanly` (~line 510): same assertion

Search for `assert_eq!(ver, 6` in the file and replace all three occurrences with `assert_eq!(ver, 7`.

Also add a spot-check for the new column:
```rust
conn.execute_batch("SELECT updated_at FROM comments LIMIT 0").unwrap();
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p kanwise-server -- migrations`
Expected: PASS — migration test creates fresh DB and applies all v1-v7.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/db/migrations.rs
git commit -m "feat(db): add v7 migration — updated_at column + FTS5 update trigger for comments"
```

---

### Task 2: Comment Model Update

**Files:**
- Modify: `crates/server/src/db/models.rs`

- [ ] **Step 1: Add `updated_at` to Comment struct**

In `crates/server/src/db/models.rs`, find the `Comment` struct (~line 223-230):

```rust
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
}
```

Add after `created_at`:

```rust
    pub updated_at: Option<DateTime<Utc>>,
```

- [ ] **Step 2: Fix all compilation errors**

This will cause compile errors everywhere `Comment { ... }` is constructed without `updated_at`. Fix them all in subsequent tasks. For now, just verify the struct compiles on its own.

- [ ] **Step 3: Commit**

```bash
git add crates/server/src/db/models.rs
git commit -m "feat(models): add updated_at field to Comment struct"
```

---

### Task 3: Update Existing Db Methods + Add New Ones

**Files:**
- Modify: `crates/server/src/db/repo.rs`

- [ ] **Step 1: Update `create_comment` (~line 1166-1198)**

The `Comment` struct construction at the end of `create_comment` needs `updated_at: None`. Find:

```rust
Ok(Comment {
    id,
    task_id,
    user_id,
    user_name,
    content,
    created_at: Utc::now(),
})
```

Add `updated_at: None` after `created_at`:

```rust
Ok(Comment {
    id,
    task_id,
    user_id,
    user_name,
    content,
    created_at: Utc::now(),
    updated_at: None,
})
```

- [ ] **Step 2: Update `list_comments` (~line 1200-1226)**

Update the SELECT to include `c.updated_at` and the struct construction. The SQL becomes:

```sql
SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
FROM comments c
LEFT JOIN users u ON u.id = c.user_id
WHERE c.task_id = ?1 ORDER BY c.created_at
```

In the `query_map` closure, add after `user_name: row.get(5)?`:

```rust
updated_at: row.get::<_, Option<String>>(6)?
    .as_deref()
    .map(parse_dt)
    .transpose()?,
```

Note: `parse_dt` returns `Result<DateTime<Utc>, rusqlite::Error>`. For `Option<String>` columns, we need to map through the Option. Check how other nullable DateTime columns are handled in the codebase and follow that pattern.

- [ ] **Step 3: Update `get_comments_for_board` (~line 2043-2071)**

Same pattern as `list_comments` — add `c.updated_at` to SELECT and parse it in the struct. The SQL becomes:

```sql
SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
FROM comments c
JOIN tasks t ON t.id = c.task_id
LEFT JOIN users u ON u.id = c.user_id
WHERE t.board_id = ?1
ORDER BY c.created_at
```

Add the same `updated_at` field parsing as Step 2.

- [ ] **Step 4: Add `get_comment` method**

Add a new method to fetch a single comment by ID:

```rust
pub async fn get_comment(&self, comment_id: &str) -> anyhow::Result<Option<Comment>> {
    let comment_id = comment_id.to_string();
    self.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
             FROM comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.id = ?1",
        )?;
        let comment = stmt
            .query_row(params![comment_id], |row| {
                Ok(Comment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    user_id: row.get(2)?,
                    content: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                    user_name: row.get(5)?,
                    updated_at: row.get::<_, Option<String>>(6)?
                        .as_deref()
                        .map(parse_dt)
                        .transpose()?,
                })
            })
            .optional()?;
        Ok(comment)
    })
    .await
}
```

- [ ] **Step 5: Add `update_comment` method**

```rust
pub async fn update_comment(
    &self,
    comment_id: &str,
    content: &str,
) -> anyhow::Result<Option<Comment>> {
    let comment_id = comment_id.to_string();
    let content = content.to_string();
    self.with_conn(move |conn| {
        let now = now_iso();
        let rows = conn.execute(
            "UPDATE comments SET content = ?1, updated_at = ?2 WHERE id = ?3",
            params![content, now, comment_id],
        )?;
        if rows == 0 {
            return Ok(None);
        }
        // Re-fetch to get full comment with user_name
        let mut stmt = conn.prepare(
            "SELECT c.id, c.task_id, c.user_id, c.content, c.created_at, u.name, c.updated_at
             FROM comments c
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.id = ?1",
        )?;
        let comment = stmt
            .query_row(params![comment_id], |row| {
                Ok(Comment {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    user_id: row.get(2)?,
                    content: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?)?,
                    user_name: row.get(5)?,
                    updated_at: row.get::<_, Option<String>>(6)?
                        .as_deref()
                        .map(parse_dt)
                        .transpose()?,
                })
            })
            .optional()?;
        Ok(comment)
    })
    .await
}
```

- [ ] **Step 6: Add `delete_comment` method**

```rust
pub async fn delete_comment(&self, comment_id: &str) -> anyhow::Result<bool> {
    let comment_id = comment_id.to_string();
    self.with_conn(move |conn| {
        let rows = conn.execute(
            "DELETE FROM comments WHERE id = ?1",
            params![comment_id],
        )?;
        Ok(rows > 0)
    })
    .await
}
```

- [ ] **Step 7: Verify compilation**

Run: `cargo check -p kanwise-server`
Expected: Compilation succeeds (or fails only on remaining `Comment` construction sites in cli.rs — handled in Task 5).

- [ ] **Step 8: Commit**

```bash
git add crates/server/src/db/repo.rs
git commit -m "feat(db): update comment queries for updated_at, add get/update/delete methods"
```

---

## Chunk 2: Backend — API Layer

### Task 4: Comment API Handlers (Update + Delete)

**Files:**
- Modify: `crates/server/src/api/comments.rs`
- Modify: `crates/server/src/api/mod.rs`

- [ ] **Step 1: Add `UpdateComment` request body and `update` handler**

In `crates/server/src/api/comments.rs`, add after the existing `CreateComment` struct:

```rust
#[derive(Deserialize)]
pub struct UpdateComment {
    pub content: String,
}
```

Add the `update` handler after the `create` handler:

```rust
pub async fn update(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, cid)): Path<(String, String, String)>,
    Json(body): Json<UpdateComment>,
) -> Result<Json<Comment>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db.get_comment(&cid).await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    if comment.user_id != user.id {
        return Err(ApiError::Forbidden("not the comment author".into()));
    }
    let updated = db.update_comment(&cid, &body.content).await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "comment_updated",
        Some(&serde_json::json!({"task_id": &tid, "comment_id": &cid}).to_string())).await;
    Ok(Json(updated))
}
```

- [ ] **Step 2: Add `delete` handler**

```rust
pub async fn delete(
    State(db): State<Db>,
    AuthUser(user): AuthUser,
    Path((board_id, tid, cid)): Path<(String, String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    permissions::require_role(&db, &board_id, &user.id, Role::Member).await?;
    let comment = db.get_comment(&cid).await?
        .ok_or(ApiError::NotFound("comment not found".into()))?;
    if comment.user_id != user.id {
        return Err(ApiError::Forbidden("not the comment author".into()));
    }
    db.delete_comment(&cid).await?;
    let _ = db.log_activity(&board_id, Some(&tid), &user.id, "comment_deleted",
        Some(&serde_json::json!({"task_id": &tid, "comment_id": &cid}).to_string())).await;
    Ok(Json(serde_json::json!({"deleted": true})))
}
```

Note: `ApiError::Forbidden(String)` and `ApiError::NotFound(String)` both take a String argument. Check if `serde_json` is already imported or needs adding to the use statements.

- [ ] **Step 3: Add route in `api/mod.rs`**

In `crates/server/src/api/mod.rs`, find the line (~63):

```rust
.route("/comments", get(comments::list).post(comments::create))
```

Add after it:

```rust
.route("/comments/{cid}", put(comments::update).delete(comments::delete))
```

The existing import is `use axum::routing::{get, patch, post, put};` — `put` is already imported but `delete` is not. Add `delete` to this import: `use axum::routing::{delete, get, patch, post, put};`.

- [ ] **Step 4: Verify compilation**

Run: `cargo check -p kanwise-server`
Expected: Compiles (may still fail on cli.rs — handled in next task).

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/api/comments.rs crates/server/src/api/mod.rs
git commit -m "feat(api): add PUT/DELETE endpoints for comments with author-only auth"
```

---

## Chunk 3: Backend — Export/Import + MCP

### Task 5: Update Export/Import for `updated_at`

**Files:**
- Modify: `crates/server/src/cli.rs`

- [ ] **Step 1: Update `ExportedComment` struct (~line 82-90)**

Add `updated_at` field:

```rust
pub struct ExportedComment {
    pub id: String,
    pub task_id: String,
    pub user_id: String,
    pub user_name: Option<String>,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,  // NEW
}
```

- [ ] **Step 2: Update export query**

Find where `ExportedComment` is constructed from DB rows in the export code. Add `updated_at` field. The export query selects from `comments` — it needs to include `updated_at` in the SELECT and map it to the struct.

Look for the `get_comments_for_board` call or inline query used in export. The `ExportedComment` is built from `Comment` objects — if it maps from `Comment`, the field is already there after Task 2. Check and adjust.

**Important:** There are **two** places where `ExportedComment` is constructed:
1. The `export_board` function (~line 302-309) — the actual export
2. The `export_import_roundtrip` test (~line 740-748) — constructs `ExportedComment` directly

Both must include `updated_at`. For the test, add `updated_at: None` to the struct construction.

- [ ] **Step 3: Update import INSERT (~line 556-567)**

In the comments import loop, update the INSERT to include `updated_at`:

```sql
INSERT INTO comments (id, task_id, user_id, content, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
```

Add the `updated_at` param:

```rust
rusqlite::params![
    new_id,
    new_task_id,
    effective_user_id,
    comment.content,
    comment.created_at.to_rfc3339(),
    comment.updated_at.map(|dt| dt.to_rfc3339()),
],
```

- [ ] **Step 4: Verify compilation**

Run: `cargo check -p kanwise-server`
Expected: Full compilation succeeds — all `Comment` and `ExportedComment` construction sites now include `updated_at`.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/cli.rs
git commit -m "feat(cli): add updated_at to comment export/import"
```

---

### Task 6: MCP — Add `update_comment` and `delete_comment` Actions

**Files:**
- Modify: `crates/server/src/mcp/tools.rs`
- Modify: `crates/server/src/mcp/sse.rs`

- [ ] **Step 1: Add `update_comment` action**

In `handle_mutate`, find the `"add_comment"` match arm (~line 379-391). Add after it:

```rust
"update_comment" => {
    let comment_id = json_str(data, "comment_id")?;
    let comment = self.db.get_comment(comment_id).await?
        .ok_or_else(|| anyhow::anyhow!("comment not found: {comment_id}"))?;
    // Verify comment belongs to a task on this board
    let task = self.db.get_task(&comment.task_id).await?
        .ok_or_else(|| anyhow::anyhow!("task not found: {}", comment.task_id))?;
    if task.board_id != *board_id {
        bail!("comment's task does not belong to board {board_id}");
    }
    let content = json_str(data, "content")?;
    let updated = self.db.update_comment(comment_id, content).await?
        .ok_or_else(|| anyhow::anyhow!("failed to update comment {comment_id}"))?;
    Ok(format!("updated comment {}", updated.id))
}
```

- [ ] **Step 2: Add `delete_comment` action**

```rust
"delete_comment" => {
    let comment_id = json_str(data, "comment_id")?;
    let comment = self.db.get_comment(comment_id).await?
        .ok_or_else(|| anyhow::anyhow!("comment not found: {comment_id}"))?;
    let task = self.db.get_task(&comment.task_id).await?
        .ok_or_else(|| anyhow::anyhow!("task not found: {}", comment.task_id))?;
    if task.board_id != *board_id {
        bail!("comment's task does not belong to board {board_id}");
    }
    self.db.delete_comment(comment_id).await?;
    Ok(format!("deleted comment {comment_id}"))
}
```

- [ ] **Step 3: Add activity logging to MCP actions**

After each MCP action completes, log activity for consistency with the API handlers. In `update_comment`, after the successful update:
```rust
let _ = self.db.log_activity(board_id, Some(&comment.task_id), &comment.user_id, "comment_updated",
    Some(&serde_json::json!({"task_id": &comment.task_id, "comment_id": comment_id}).to_string())).await;
```

In `delete_comment`, after the successful delete:
```rust
let _ = self.db.log_activity(board_id, Some(&comment.task_id), &comment.user_id, "comment_deleted",
    Some(&serde_json::json!({"task_id": &comment.task_id, "comment_id": comment_id}).to_string())).await;
```

- [ ] **Step 4: Update the tool schema in sse.rs**

In `crates/server/src/mcp/sse.rs`, find the `board_mutate` tool's JSON schema (~line 73). The `action` enum lists available actions. Add `"update_comment"` and `"delete_comment"` to the enum array.

Also update the tool description to document the new actions:
- `update_comment` requires `comment_id` and `content`
- `delete_comment` requires `comment_id`

- [ ] **Step 5: Verify compilation**

Run: `cargo check -p kanwise-server`
Expected: Full compilation succeeds.

- [ ] **Step 6: Run full test suite**

Run: `cargo test -p kanwise-server`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add crates/server/src/mcp/tools.rs crates/server/src/mcp/sse.rs
git commit -m "feat(mcp): add update_comment and delete_comment actions to board_mutate"
```

---

## Chunk 4: Frontend

### Task 7: Update API Client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add `updated_at` to Comment interface**

Find the `Comment` interface (~line 365-372):

```typescript
export interface Comment {
  id: string
  task_id: string
  user_id: string
  user_name?: string
  content: string
  created_at: string
}
```

Add after `created_at`:

```typescript
  updated_at: string | null
```

- [ ] **Step 2: Add `updateComment` method**

Find the comment API methods (~line 108-118). Add after `createComment`:

```typescript
updateComment: (boardId: string, taskId: string, commentId: string, data: { content: string }) =>
  request<Comment>(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
```

- [ ] **Step 3: Add `deleteComment` method**

```typescript
deleteComment: (boardId: string, taskId: string, commentId: string) =>
  request<{ deleted: boolean }>(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}`, {
    method: 'DELETE',
  }),
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: May have errors in TaskEditor.tsx since we changed the Comment type — that's fine, handled in Task 8.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): add updated_at to Comment type, add updateComment/deleteComment methods"
```

---

### Task 8: TaskEditor — Rich Text Comment Input + Display

**Files:**
- Modify: `frontend/src/components/board/TaskEditor.tsx`

This is the most complex frontend task. It involves:
1. Replacing the plain `<Input>` with `<TiptapEditor>` for new comments
2. Rendering comment content as HTML instead of plain text
3. Adding edit mode with `<TiptapEditor>` pre-filled
4. Adding delete with confirmation
5. Showing "(edited)" indicator

- [ ] **Step 1: Update imports and state**

Add imports at the top of TaskEditor.tsx:

```typescript
import TiptapEditor from '../editor/TiptapEditor'
```

Add `Pencil` to the existing `lucide-react` import (which already has `Archive`, `Trash2`, `Send`, `ChevronRight`, `UserIcon` etc.):

```typescript
import { ..., Pencil } from 'lucide-react'
```

Replace the comment-related state variables. Find (~line 64-65):

```typescript
const [newComment, setNewComment] = useState('')
```

Replace with:

```typescript
const [newCommentHtml, setNewCommentHtml] = useState('')
const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
const [editingCommentHtml, setEditingCommentHtml] = useState('')
```

Keep `submittingComment` state as-is.

- [ ] **Step 2: Update `handleAddComment` (~line 170-185)**

Update to use `newCommentHtml` instead of `newComment`:

Note: Tiptap's `getHTML()` returns `<p></p>` for an empty editor, not `""`. Use a helper to strip HTML tags before checking emptiness. Check if `stripHtml` is exported from TiptapEditor.tsx — if so, import and use it. Otherwise, use a simple regex: `newCommentHtml.replace(/<[^>]*>/g, '').trim()`.

```typescript
const handleAddComment = async () => {
  const isEmpty = !newCommentHtml.replace(/<[^>]*>/g, '').trim()
  if (isEmpty || !task || submittingComment) return
  setSubmittingComment(true)
  try {
    const comment = await api.createComment(boardId, task.id, { content: newCommentHtml })
    setComments((prev) => [...prev, comment])
    setNewCommentHtml('')
  } catch (e) {
    console.error('Failed to add comment', e)
  } finally {
    setSubmittingComment(false)
  }
}
```

Note: The TiptapEditor content reset needs special handling — setting `newCommentHtml` to `''` should trigger the editor to clear via its `content` prop. Check if the TiptapEditor responds to external content changes via its useEffect (~line 151-165 of TiptapEditor.tsx). It does: `editor.commands.setContent(content)`.

- [ ] **Step 3: Add `handleUpdateComment` and `handleDeleteComment` functions**

```typescript
const handleUpdateComment = async (commentId: string) => {
  const isEmpty = !editingCommentHtml.replace(/<[^>]*>/g, '').trim()
  if (isEmpty || !task) return
  try {
    const updated = await api.updateComment(boardId, task.id, commentId, { content: editingCommentHtml })
    setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)))
    setEditingCommentId(null)
    setEditingCommentHtml('')
  } catch (e) {
    console.error('Failed to update comment', e)
  }
}

const handleDeleteComment = async (commentId: string) => {
  if (!task) return
  if (!window.confirm('Delete this comment?')) return
  try {
    await api.deleteComment(boardId, task.id, commentId)
    setComments((prev) => prev.filter((c) => c.id !== commentId))
  } catch (e) {
    console.error('Failed to delete comment', e)
  }
}
```

- [ ] **Step 4: Replace comment display section (~line 399-462)**

Find the comment display section. It currently renders each comment as:

```tsx
<p className="text-sm">{comment.content}</p>
```

Replace with HTML rendering + edit/delete controls. **Preserve the existing avatar circle** (the `<div>` that shows user initials, ~lines 427-429) — keep it before the comment content. Each comment body should be:

```tsx
{editingCommentId === comment.id ? (
  <div className="flex-1">
    <TiptapEditor
      content={editingCommentHtml}
      onChange={setEditingCommentHtml}
      placeholder="Edit comment..."
      boardId={boardId}
      taskId={task.id}
    />
    <div className="flex gap-2 mt-2">
      <Button size="sm" onClick={() => handleUpdateComment(comment.id)}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => {
        setEditingCommentId(null)
        setEditingCommentHtml('')
      }}>
        Cancel
      </Button>
    </div>
  </div>
) : (
  <div className="flex-1 group">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{comment.user_name || 'Unknown'}</span>
      <span className="text-xs text-muted-foreground">
        {formatDate(comment.created_at)}
        {comment.updated_at && <span className="ml-1">(edited)</span>}
      </span>
      {comment.user_id === currentUser?.id && (
        <div className="opacity-0 group-hover:opacity-100 flex gap-1 ml-auto">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              setEditingCommentId(comment.id)
              setEditingCommentHtml(comment.content)
            }}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => handleDeleteComment(comment.id)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      )}
    </div>
    <div
      className="prose prose-sm dark:prose-invert max-w-none text-sm mt-1"
      dangerouslySetInnerHTML={{ __html: comment.content }}
    />
  </div>
)}
```

Note: `Pencil` was added to imports in Step 1. `Trash2` and `Button` are already imported in the existing file. Use `size-3` class for icons (not `h-3 w-3`) to match codebase conventions.

The `currentUser` should come from the auth store. Check how the current user ID is accessed in the TaskEditor — look for existing patterns like `useAuthStore()` or similar.

- [ ] **Step 5: Replace comment input section**

Find the comment input area (the `<Input>` with Enter-key handler). Replace with:

```tsx
<div className="mt-4">
  <TiptapEditor
    content={newCommentHtml}
    onChange={setNewCommentHtml}
    placeholder="Write a comment..."
    boardId={boardId}
    taskId={task.id}
  />
  <div className="flex justify-end mt-2">
    <Button
      size="sm"
      onClick={handleAddComment}
      disabled={!newCommentHtml.replace(/<[^>]*>/g, '').trim() || submittingComment}
    >
      {submittingComment ? 'Sending...' : 'Comment'}
    </Button>
  </div>
</div>
```

Remove the old `<Input>` element and the `onKeyDown` Enter handler since Enter now creates newlines in the editor.

- [ ] **Step 6: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/board/TaskEditor.tsx
git commit -m "feat(ui): rich text comments with Tiptap editor, edit/delete support"
```

---

## Chunk 5: Verification

### Task 9: Full Stack Verification

- [ ] **Step 1: Run backend tests**

Run: `cargo test -p kanwise-server`
Expected: All tests pass.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy -p kanwise-server -- -D warnings`
Expected: No warnings.

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run frontend lint**

Run: `cd frontend && npx eslint src --ext .ts,.tsx`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 5: Run E2E tests if available**

Run: `cd frontend && npx playwright test` (if tests exist)
Expected: Existing tests pass. Comment tests may need updates if they check for the old `<Input>` element.

- [ ] **Step 6: Final commit if any fixes needed**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address lint/test issues from lot3b implementation"
```
