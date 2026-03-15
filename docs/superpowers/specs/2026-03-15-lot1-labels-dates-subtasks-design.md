# Lot 1 Design — Labels, Due Dates, Subtasks

**Date**: 2026-03-15
**Status**: Approved
**Scope**: Fondations pour Kanwise v2 — primitives de données exploitées par les lots suivants (search, AI, automations)

---

## Overview

Trois features fondamentales ajoutées en parallèle sur l'UI, l'API REST et le protocole MCP/KBF :

1. **Labels/tags** — étiquettes colorées par board, attachables aux tasks
2. **Due dates** — date d'échéance native sur les tasks
3. **Subtasks/checklists** — sous-tâches avec progression

Chaque feature est exposée à la fois dans l'UI React et via MCP pour les agents AI.

---

## 1. Data Model

### Migration v4

```sql
-- Labels (par board, réutilisables sur plusieurs tasks)
CREATE TABLE labels (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_labels_board ON labels(board_id);
CREATE UNIQUE INDEX idx_labels_board_name ON labels(board_id, name);

-- Relation many-to-many tasks <-> labels
CREATE TABLE task_labels (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX idx_task_labels_task ON task_labels(task_id);
CREATE INDEX idx_task_labels_label ON task_labels(label_id);

-- Subtasks
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);

-- Due date on tasks
ALTER TABLE tasks ADD COLUMN due_date TEXT;
```

---

## 2. Backend API

### Labels

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/boards/:id/labels` | — | List board labels |
| POST | `/api/v1/boards/:id/labels` | `{ name, color }` | Create label |
| PUT | `/api/v1/boards/:id/labels/:lid` | `{ name?, color? }` | Update label |
| DELETE | `/api/v1/boards/:id/labels/:lid` | — | Delete label (cascades task_labels) |
| POST | `/api/v1/boards/:id/tasks/:tid/labels` | `{ label_id }` | Attach label to task |
| DELETE | `/api/v1/boards/:id/tasks/:tid/labels/:lid` | — | Detach label from task |

### Due dates

No new endpoint. The existing `PUT /api/v1/boards/:id/tasks/:tid` accepts `due_date` (ISO 8601 string or null) in the request body.

### Subtasks

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/boards/:id/tasks/:tid/subtasks` | — | List subtasks |
| POST | `/api/v1/boards/:id/tasks/:tid/subtasks` | `{ title }` | Create subtask |
| PUT | `/api/v1/boards/:id/tasks/:tid/subtasks/:sid` | `{ title?, completed?, position? }` | Update subtask |
| DELETE | `/api/v1/boards/:id/tasks/:tid/subtasks/:sid` | — | Delete subtask |

### Activity logging

All mutations log to the existing activity feed:

| Action | Details JSON |
|--------|-------------|
| `label_created` | `{ "name": "...", "color": "..." }` |
| `label_updated` | `{ "name": "...", "changes": {...} }` |
| `label_deleted` | `{ "name": "..." }` |
| `label_added` | `{ "task_title": "...", "label_name": "..." }` |
| `label_removed` | `{ "task_title": "...", "label_name": "..." }` |
| `due_date_set` | `{ "task_title": "...", "due_date": "..." }` |
| `due_date_removed` | `{ "task_title": "..." }` |
| `subtask_created` | `{ "task_title": "...", "subtask_title": "..." }` |
| `subtask_completed` | `{ "task_title": "...", "subtask_title": "..." }` |
| `subtask_uncompleted` | `{ "task_title": "...", "subtask_title": "..." }` |
| `subtask_deleted` | `{ "task_title": "...", "subtask_title": "..." }` |

### Rust model additions

```rust
pub struct Label {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub color: String,  // validated: must match ^#[0-9a-fA-F]{6}$
    pub created_at: DateTime<Utc>,
}

pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub completed: bool,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

// Task struct gains:
pub due_date: Option<String>,

// New response struct for task list/detail (avoids polluting the base Task model):
pub struct TaskWithRelations {
    #[serde(flatten)]
    pub task: Task,  // includes due_date
    pub labels: Vec<Label>,
    pub subtask_count: SubtaskCount,
}

pub struct SubtaskCount {
    pub completed: i32,
    pub total: i32,
}
```

### Cross-cutting: `update_task` signature change

The existing `Db::update_task()` gains a new `due_date: Option<Option<&str>>` parameter (None = no change, Some(None) = clear, Some(Some(d)) = set).

**All call sites must be updated:**
- `api/tasks.rs` — REST handler (add `due_date` to `UpdateTaskRequest`)
- `mcp/tools.rs` — `update_task` action in `board_mutate`
- `mcp/tools.rs` — `apply_field_update` delta handler (add `"due"` field arm for `board_sync`)

---

## 3. MCP / KBF

### board_query changes

**Existing scopes extended:**
- `tasks` and `full` scopes now include labels (IDs), due_date, and subtask counts per task

**New scopes:**
- `labels` — returns board labels in KBF
- `subtasks` — returns subtasks for a specific task. `BoardQueryParams` gains an optional `task_id: Option<String>` field, required when `scope = "subtasks"`

### KBF format additions

```
#label@v1:id,name,color
lb1|Bug|#ef4444
lb2|Feature|#3b82f6

#task@v2:id,col,title,desc,pri,who,pos,due,labels,subtasks
t1|col-1|Fix auth||h|alice|0|2026-03-20|lb1,lb2|2/5
t2|col-2|Design flow||m|bob|0||lb2|0/3

#subtask@v1:id,task_id,title,done,pos
s1|t1|Write tests|1|0
s2|t1|Update docs|0|1
```

- `due`: ISO date or empty
- `labels`: comma-separated label IDs
- `subtasks`: `completed/total` ratio (compact for snapshots)

### board_mutate new actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `create_label` | `{ board_id, name, color }` | Create a board label |
| `update_label` | `{ board_id, label_id, name?, color? }` | Update label name/color |
| `delete_label` | `{ board_id, label_id }` | Delete a label |
| `add_label` | `{ board_id, task_id, label_id }` | Attach label to task |
| `remove_label` | `{ board_id, task_id, label_id }` | Detach label from task |
| `create_subtask` | `{ board_id, task_id, title }` | Create subtask |
| `update_subtask` | `{ board_id, subtask_id, completed?, title? }` | Update subtask |
| `delete_subtask` | `{ board_id, subtask_id }` | Delete subtask |

The existing `update_task` action accepts `due_date`.

**Board ownership validation:** All actions include `board_id`. Implementations must verify that the targeted entity (label, subtask) belongs to the specified board before mutating, consistent with existing patterns in `tools.rs`.

### KBF encoding changes

- `kbf_bridge.rs`: extend task encoding to include `due_date`, label IDs, subtask counts
- New `encode_labels()` function for label schema
- New `encode_subtasks()` function for subtask schema
- Task schema bumps from `@v1` to `@v2` (appends `due`, `labels`, `subtasks` fields)

### board_sync delta handling

New field arms in `apply_field_update`:
- `>t1.due=2026-04-01` — set due date
- `>t1.due=` — clear due date
- Labels and subtasks are NOT delta-updatable (use `board_mutate` actions instead, as they involve cross-table operations)

---

## 4. Frontend

### TaskCard (board view)

- **Labels**: colored pills (`text-xs`, rounded) below the title, max 3 visible + "+N" overflow
- **Due date**: bottom-right, gray text if OK, orange if due within 2 days, red if overdue, hidden if null
- **Subtasks**: bottom-left, `check-icon 2/5` with mini progress bar (thin colored line)

### FilterBar

- **Labels filter**: multi-select dropdown with colored pills matching board labels
- **Due date filter**: select with options: All, Overdue, Due this week, Due this month, No date

### TaskDialog (Notion-like detail view)

- **Labels property row**: click opens popover with board labels as checkboxes + "Create label" button with inline name + color picker
- **Due date property row**: click opens date picker (calendar component from shadcn/ui)
- **Subtasks section**: between description and comments
  - Collapsible header: `Subtasks (2/5)` with progress bar
  - List of checkboxes, draggable for reorder (@dnd-kit)
  - "Add subtask" input at bottom (Enter to add, auto-focus)

### Board settings — Labels management

- Accessible from board header (tag icon button)
- Popover with list of board labels
- Each label: color dot + name + edit/delete buttons
- "Add label" at bottom with name input + color palette (8-10 predefined colors)
- Predefined palette: `#ef4444` (red), `#f97316` (orange), `#eab308` (yellow), `#22c55e` (green), `#3b82f6` (blue), `#8b5cf6` (purple), `#ec4899` (pink), `#6b7280` (gray)

### TypeScript types

```typescript
interface Label {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
}

interface Subtask {
  id: string
  task_id: string
  title: string
  completed: boolean
  position: number
  created_at: string
}

// Task gains:
interface Task {
  // ... existing fields
  due_date?: string | null
  labels?: Label[]
  subtask_count?: { completed: number; total: number }
}
```

### API client additions

```typescript
// Labels
api.listLabels(boardId): Promise<Label[]>
api.createLabel(boardId, data: { name: string; color: string }): Promise<Label>
api.updateLabel(boardId, labelId, data: Partial<Label>): Promise<Label>
api.deleteLabel(boardId, labelId): Promise<void>
api.addTaskLabel(boardId, taskId, labelId): Promise<void>
api.removeTaskLabel(boardId, taskId, labelId): Promise<void>

// Subtasks
api.listSubtasks(boardId, taskId): Promise<Subtask[]>
api.createSubtask(boardId, taskId, data: { title: string }): Promise<Subtask>
api.updateSubtask(boardId, taskId, subtaskId, data: Partial<Subtask>): Promise<Subtask>
api.deleteSubtask(boardId, taskId, subtaskId): Promise<void>
```

---

## Files affected

### Backend (Rust)

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | Add v4 migration |
| `crates/server/src/db/models.rs` | Add Label, Subtask structs; add due_date to Task |
| `crates/server/src/db/repo.rs` | Add CRUD methods for labels, task_labels, subtasks; modify task queries to include due_date |
| `crates/server/src/api/mod.rs` | Register new route modules |
| `crates/server/src/api/labels.rs` | **New** — label CRUD + task label attach/detach handlers |
| `crates/server/src/api/subtasks.rs` | **New** — subtask CRUD handlers |
| `crates/server/src/api/tasks.rs` | Accept due_date in update; include labels/subtask_count in responses |
| `crates/server/src/mcp/tools.rs` | Add new mutate actions; extend query scopes |
| `crates/server/src/mcp/kbf_bridge.rs` | Extend task encoding; add label/subtask encoding |
| `crates/kbf/src/schema.rs` | Add label and subtask schemas |
| `crates/kbf/src/encode.rs` | Add label/subtask encode functions |
| `crates/kbf/src/decode.rs` | Add label/subtask decode functions |

### Frontend (React/TypeScript)

| File | Change |
|------|--------|
| `frontend/src/lib/api.ts` | Add Label, Subtask types; add API methods |
| `frontend/src/stores/board.ts` | Add labels state; extend task state with due_date, labels, subtasks |
| `frontend/src/components/board/TaskCard.tsx` | Add label pills, due date badge, subtask indicator |
| `frontend/src/components/board/TaskDialog.tsx` | Add Labels row, Due date row, Subtasks section |
| `frontend/src/components/board/LabelPicker.tsx` | **New** — label multi-select popover with create inline |
| `frontend/src/components/board/SubtaskList.tsx` | **New** — draggable checkbox list with add input |
| `frontend/src/components/board/LabelManager.tsx` | **New** — board label CRUD popover |
| `frontend/src/components/board/FilterBar.tsx` | Add label and due date filters |
| `frontend/src/pages/BoardPage.tsx` | Wire label manager button in header |

---

## API response shape changes

`GET /api/v1/boards/:id/tasks` and `GET /api/v1/boards/:id/tasks/:tid` return `TaskWithRelations` instead of `Task`. This includes labels (via JOIN on `task_labels` + `labels`) and subtask counts (via subquery `SELECT COUNT(*), SUM(completed) FROM subtasks WHERE task_id = ?`). The JOINs are indexed and negligible on SQLite.

---

## Non-goals

- No recurring due dates
- No label grouping/categories
- No subtask assignment (subtasks are simple checklists)
- No subtask due dates
- No dependency between subtasks
- No real-time sync of subtasks via CRDT (REST only, refresh on open)
