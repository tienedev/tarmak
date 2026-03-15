# Kanwise MCP Tool Reference

## board_query

Query board state.

```
board_query: { board_id, scope?: "info"|"tasks"|"columns"|"all", format?: "kbf"|"json" }
```

- `board_id`: UUID of the board, or `"list"` to list all boards
- `scope`: what to return (default: `"info"`)
- `format`: response format (default: `"json"`)

## board_mutate

Modify board state.

```
board_mutate: { board_id, action, data }
```

Actions:
- `create_task` — data: `{ title, column_id, description? }`
- `update_task` — data: `{ task_id, title?, description?, column_id? }`
- `move_task` — data: `{ task_id, column_id }`
- `delete_task` — data: `{ task_id }`
- `create_column` — data: `{ title, position? }`
- `create_board` — data: `{ title }`

## board_sync

Sync board state with delta support.

```
board_sync: { board_id, delta?, format? }
```
