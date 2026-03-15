# Kanban Board Memory Schema

Save to project memory as `kanban_board.md`:

```markdown
---
name: kanban-board-mapping
description: Kanwise board mapping for this project
type: project
---

Board ID: <uuid>
Board name: <name>
Column mapping:
  BACKLOG: <column_id>
  IN_PROGRESS: <column_id>
  DONE: <column_id>
```

## Column Name Pattern Matching

| Pattern (case-insensitive) | Stage |
|---|---|
| `backlog`, `to do`, `todo`, `a faire` | BACKLOG |
| `in progress`, `doing`, `en cours` | IN_PROGRESS |
| `done`, `complete`, `termine`, `fait` | DONE |

If a column name doesn't match any pattern, ask the user once and save the mapping to project memory.
