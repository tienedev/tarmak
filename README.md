<div align="center">

# Kanwise

**Kanban board for AI-assisted development.**

[Architecture](#architecture) · [Quick Start](#quick-start) · [MCP Server](#mcp-server) · [Features](#features) · [Contributing](#contributing)

</div>

---

Kanwise is a kanban board built for AI-assisted development. It ships as a single Rust binary with a web UI, a WebSocket-based real-time sync engine, and an MCP server that any AI agent can talk to.

## Architecture

```
crates/
  kanwise/   # Kanban board (REST + WebSocket + MCP server)
  kbf/       # Kanban Bit Format codec
frontend/    # React 19 + TypeScript + Tailwind + shadcn/ui
```

## Quick Start

### From source

```bash
git clone https://github.com/tienedev/kanwise.git
cd kanwise
cargo build --workspace
```

This produces the `kanwise` binary in `target/debug/`:

```bash
./target/debug/kanwise --help
```

### Running

```bash
# Web server (port 3001) + embedded frontend
kanwise serve

# MCP server (stdio, no web server)
kanwise mcp

# Docker
docker run -d -p 3001:3001 -v kanwise-data:/data ghcr.io/tienedev/kanwise:latest
```

### MCP configuration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "kanwise": {
      "command": "kanwise",
      "args": ["mcp"]
    }
  }
}
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `kanwise.db` | SQLite database path |
| `KANBAN_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3001` | CORS origins |
| `KANBAN_ENV` | — | Set to `production` to enforce security |

## MCP Server

When running `kanwise mcp`, Kanwise exposes 4 tools over stdio:

| Tool | Purpose |
|------|---------|
| `board_query` | Read board state (KBF or JSON) |
| `board_mutate` | Create, update, move, delete entities |
| `board_sync` | Apply KBF deltas, return current state |
| `board_ask` | Natural language queries about the board |

## Features

### KBF: 95% fewer tokens

Kanwise uses **KBF (Kanban Bit Format)**, a compact protocol for AI interactions:

```
# JSON: 2,847 tokens
{"boards":[{"id":"abc-123","name":"Sprint 24","columns":[...]}]}

# KBF: 142 tokens (95% reduction)
B|abc-123|Sprint 24
C|col-1|Todo|0
T|task-1|Fix auth bug|high|0
```

### Views

Drag-and-drop kanban, sortable list, Gantt-style timeline.

### Rich editing

Tiptap editor with markdown support.

### Custom fields

Text, number, URL, date fields on any board.

### Collaboration

Real-time CRDT sync (Yjs), live presence, comments, invite links.

### Auth

Argon2 passwords, session tokens, API keys.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum, tokio, SQLite (rusqlite + tokio-rusqlite) |
| Frontend | React 19, TypeScript, Tailwind CSS, shadcn/ui |
| Real-time | Yjs (CRDT), y-websocket |
| MCP | rmcp (Rust MCP library), stdio transport |

## Contributing

```bash
git clone https://github.com/tienedev/kanwise.git
cd kanwise
make install  # frontend dependencies
make dev      # backend (3001) + frontend (3000) with hot reload
```

```bash
cargo test --workspace                       # run all tests
cargo clippy --workspace -- -D warnings      # lint
```

## License

[MIT](LICENSE)
