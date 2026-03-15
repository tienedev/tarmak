# Lot 2 Design — Search, AI Activity Attribution, board_ask

**Date**: 2026-03-15
**Status**: Approved
**Scope**: Intelligence layer — exploits Lot 1 data (labels, dates, subtasks) for search, attribution, and natural language queries.

---

## Overview

Three features that make Kanwise smarter:

1. **Full-text search** — FTS5-powered search across tasks, descriptions, labels, comments, subtasks
2. **AI activity attribution** — visual distinction between human and agent actions in the activity feed
3. **board_ask MCP tool** — keyword-pattern query engine for natural language questions from AI agents

---

## 1. Full-Text Search

### Data Model — FTS5 Virtual Table

Migration v5:

```sql
-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type,    -- 'task', 'comment', 'subtask'
    entity_id,      -- id of the entity
    board_id,       -- for scoping search to a board
    task_id,        -- parent task id (same as entity_id for tasks, parent for comments/subtasks)
    content,        -- searchable text
    tokenize='porter unicode61'
);

-- Triggers to keep index in sync

-- Tasks: title + description
CREATE TRIGGER IF NOT EXISTS search_idx_task_insert AFTER INSERT ON tasks BEGIN
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS search_idx_task_update AFTER UPDATE ON tasks BEGIN
    DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS search_idx_task_delete AFTER DELETE ON tasks BEGIN
    DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
END;

-- Comments
CREATE TRIGGER IF NOT EXISTS search_idx_comment_insert AFTER INSERT ON comments BEGIN
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('comment', NEW.id,
        (SELECT board_id FROM tasks WHERE id = NEW.task_id),
        NEW.task_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS search_idx_comment_delete AFTER DELETE ON comments BEGIN
    DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
END;

-- Subtasks
CREATE TRIGGER IF NOT EXISTS search_idx_subtask_insert AFTER INSERT ON subtasks BEGIN
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('subtask', NEW.id,
        (SELECT board_id FROM tasks WHERE id = NEW.task_id),
        NEW.task_id, NEW.title);
END;

CREATE TRIGGER IF NOT EXISTS search_idx_subtask_update AFTER UPDATE ON subtasks BEGIN
    DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
    INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
    VALUES ('subtask', NEW.id,
        (SELECT board_id FROM tasks WHERE id = NEW.task_id),
        NEW.task_id, NEW.title);
END;

CREATE TRIGGER IF NOT EXISTS search_idx_subtask_delete AFTER DELETE ON subtasks BEGIN
    DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
END;

-- Backfill existing data
INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
SELECT 'task', id, board_id, id, title || ' ' || COALESCE(description, '') FROM tasks;

INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
SELECT 'comment', c.id, t.board_id, c.task_id, c.content
FROM comments c INNER JOIN tasks t ON t.id = c.task_id;

INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
SELECT 'subtask', s.id, t.board_id, s.task_id, s.title
FROM subtasks s INNER JOIN tasks t ON t.id = s.task_id;
```

### Backend API

**Endpoint:** `GET /api/v1/boards/:id/search?q=term&limit=20`

**Response:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub entity_type: String,  // "task", "comment", "subtask"
    pub entity_id: String,
    pub board_id: String,
    pub task_id: String,      // for navigation — always points to parent task
    pub snippet: String,      // FTS5 snippet() with highlight markers
    pub rank: f64,            // FTS5 rank score
}
```

**Repo method:**

```sql
SELECT entity_type, entity_id, board_id, task_id,
       snippet(search_index, 4, '<mark>', '</mark>', '...', 32) as snippet,
       rank
FROM search_index
WHERE search_index MATCH ?1 AND board_id = ?2
ORDER BY rank
LIMIT ?3
```

### MCP

Add `query` field to `BoardQueryParams`:

```rust
pub struct BoardQueryParams {
    pub board_id: String,
    pub scope: Option<String>,
    pub format: Option<String>,
    pub task_id: Option<String>,
    pub query: Option<String>,  // NEW — for search scope
}
```

New scope `"search"` in `board_query`:
- Requires `query` parameter
- KBF format: `#search@v1:type,id,task_id,snippet`
- JSON format: array of `SearchResult`

### Frontend

**SearchBar component** in board header:
- Magnifying glass icon, expands to input on click
- Debounced (300ms) API call on input
- Dropdown below with results grouped by type (Tasks, Comments, Subtasks)
- Each result shows: type icon + snippet with `<mark>` highlighted
- Click → opens TaskDialog for the corresponding task_id
- Escape or click outside → close

---

## 2. AI Activity Attribution

### Backend Changes

**Modify `ActivityEntry` in `models.rs`:**

```rust
pub struct ActivityEntry {
    pub id: String,
    pub board_id: String,
    pub task_id: Option<String>,
    pub user_id: String,
    pub user_name: String,
    pub is_agent: bool,    // NEW
    pub action: String,
    pub details: Option<String>,
    pub created_at: DateTime<Utc>,
}
```

**Modify `list_activity()` query in `repo.rs`:**

Change the SELECT to include `u.is_agent`:

```sql
SELECT a.id, a.board_id, a.task_id, a.user_id, u.name as user_name,
       u.is_agent,
       a.action, a.details, a.created_at
FROM activity a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.board_id = ?1
  AND (?2 IS NULL OR a.action = ?2)
  AND (?3 IS NULL OR a.user_id = ?3)
ORDER BY a.created_at DESC
LIMIT ?4 OFFSET ?5
```

No migration needed — `is_agent` already exists on the `users` table.

### Frontend Changes

**ActivityPanel.tsx:**

- Agent entries get a robot icon (lucide `Bot`) instead of user initials avatar
- Agent avatar background: `bg-violet-100 text-violet-600` (distinct from human `bg-muted`)
- New filter toggle in ActivityPanel header: "All | Humans | Agents" — client-side filter on `is_agent`
- `ActivityEntry` TypeScript interface gains `is_agent: boolean`

---

## 3. board_ask MCP Tool

### Architecture

A 4th MCP tool that accepts natural language questions and dispatches to pre-built SQL queries based on keyword pattern matching. No server-side LLM dependency.

### MCP Interface

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoardAskParams {
    pub board_id: String,
    pub question: String,
    pub format: Option<String>,  // "text" (default) | "kbf" | "json"
}
```

### Pattern Matching

The question string is lowercased and checked against keyword patterns:

| Keywords | Query | Description |
|----------|-------|-------------|
| `overdue`, `late`, `past due`, `en retard` | `due_date < date('now') AND due_date IS NOT NULL` | Tasks past their due date |
| `due this week`, `due soon`, `cette semaine` | `due_date BETWEEN date('now') AND date('now', '+7 days')` | Tasks due within 7 days |
| `due today`, `aujourd'hui` | `due_date = date('now')` | Tasks due today |
| `no due`, `without date`, `sans date` | `due_date IS NULL` | Tasks with no due date |
| `unassigned`, `no assignee`, `sans assignee` | `assignee IS NULL OR assignee = ''` | Unassigned tasks |
| `no label`, `without label`, `sans label` | `LEFT JOIN task_labels ... WHERE tl.task_id IS NULL` | Tasks with no labels |
| `blocked`, `stale`, `stuck` | `updated_at < datetime('now', '-3 days')` excluding done-like columns | Stale tasks |
| `stats`, `summary`, `overview`, `résumé` | Aggregate query | Board statistics |
| `high priority`, `urgent` | `priority IN ('high', 'urgent')` | High/urgent tasks |
| Fallback (no pattern match) | FTS5 search | Full-text search on the question |

### Response Formats

**`text` (default):** Human-readable summary.

```
3 overdue tasks:
- "Fix auth bug" (due Mar 10, assigned to alice) [high]
- "Update docs" (due Mar 12, unassigned) [medium]
- "Deploy v2" (due Mar 14, assigned to bob) [urgent]
```

**`kbf`:** Filtered tasks in standard KBF task@v2 format.

**`json`:** Array of Task objects matching the query.

**`stats` response (text format):**
```
Board "Sprint 24" summary:
- 12 tasks total (3 todo, 5 in progress, 4 done)
- 2 overdue, 3 due this week
- 4 high/urgent priority
- Subtask completion: 18/32 (56%)
- 3 unassigned tasks
```

### Implementation

New file: `crates/server/src/mcp/board_ask.rs`

```rust
pub struct AskEngine {
    db: Db,
}

impl AskEngine {
    pub fn answer(&self, board_id: &str, question: &str, format: &str) -> Result<String> {
        let q = question.to_lowercase();

        if matches_pattern(&q, &["overdue", "late", "past due", "en retard"]) {
            self.query_overdue(board_id, format)
        } else if matches_pattern(&q, &["due this week", "due soon", "cette semaine"]) {
            self.query_due_range(board_id, 7, format)
        } else if matches_pattern(&q, &["due today", "aujourd'hui"]) {
            self.query_due_range(board_id, 0, format)
        } else if matches_pattern(&q, &["unassigned", "no assignee", "sans assignee"]) {
            self.query_unassigned(board_id, format)
        } else if matches_pattern(&q, &["no label", "without label", "sans label"]) {
            self.query_no_labels(board_id, format)
        } else if matches_pattern(&q, &["blocked", "stale", "stuck"]) {
            self.query_stale(board_id, 3, format)
        } else if matches_pattern(&q, &["stats", "summary", "overview", "résumé"]) {
            self.query_stats(board_id)
        } else if matches_pattern(&q, &["high priority", "urgent", "priorité"]) {
            self.query_high_priority(board_id, format)
        } else if matches_pattern(&q, &["no due", "without date", "sans date"]) {
            self.query_no_due_date(board_id, format)
        } else {
            // Fallback: FTS5 search
            self.search_fallback(board_id, question, format)
        }
    }
}

fn matches_pattern(question: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|p| question.contains(p))
}
```

### Tool Registration

Register `board_ask` alongside `board_query`, `board_mutate`, `board_sync` in the rmcp integration. Tool description for the LLM:

```
board_ask: Ask a natural language question about a board.
Supports: overdue tasks, due this week/today, unassigned, no labels, stale/blocked, stats/summary, high priority, no due date. Falls back to full-text search.
```

---

## Files Affected

### Backend

| File | Change |
|------|--------|
| `crates/server/src/db/migrations.rs` | Add v5: FTS5 search_index + triggers + backfill |
| `crates/server/src/db/models.rs` | Add SearchResult struct; add is_agent to ActivityEntry |
| `crates/server/src/db/repo.rs` | Add search_board() method; update list_activity() to include is_agent |
| `crates/server/src/api/mod.rs` | Register search route |
| `crates/server/src/api/search.rs` | **New** — search handler |
| `crates/server/src/api/activity.rs` | Update to pass is_agent field |
| `crates/server/src/mcp/tools.rs` | Add search scope to board_query; add board_ask tool; update BoardQueryParams |
| `crates/server/src/mcp/board_ask.rs` | **New** — AskEngine with pattern matching + query methods |
| `crates/server/src/mcp/kbf_bridge.rs` | Add search result KBF encoding |
| `crates/server/src/mcp/mod.rs` | Register board_ask module |
| `crates/server/src/main.rs` | Register board_ask in rmcp tool definitions |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/lib/api.ts` | Add SearchResult type + searchBoard() method; add is_agent to ActivityEntry |
| `frontend/src/components/board/SearchBar.tsx` | **New** — search input + dropdown results |
| `frontend/src/components/board/ActivityPanel.tsx` | Add agent badge, avatar styling, filter toggle |
| `frontend/src/pages/BoardPage.tsx` | Wire SearchBar into board header |

---

## Non-goals

- No search across multiple boards (board-scoped only)
- No fuzzy/typo-tolerant search (FTS5 porter stemmer handles inflections)
- No search result ranking customization
- No label search in FTS (labels are short — use the label filter instead)
- No real-time search index updates via CRDT
- board_ask does not use any LLM — pattern matching only
- board_ask does not support multi-board queries
