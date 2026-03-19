<div align="center">

# Cortx

**AI development orchestrator. Secure execution, persistent memory, task planning.**

[Architecture](#architecture) · [Quick Start](#quick-start) · [MCP Tools](#mcp-tools) · [Kanwise Board](#kanwise-board) · [Contributing](#contributing)

</div>

---

Cortx is an orchestrator for AI-assisted development. It wires together three organs — a **secure command proxy**, a **persistent memory**, and a **kanban planner** — behind a single MCP server that any AI agent can talk to.

Built in Rust. Ships as 4 binaries. Each organ works standalone or composed through the orchestrator.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  cortx (orchestrator)            │
│        Meta-MCP server — 15 tools, stdio        │
├────────────────┬───────────────┬────────────────┤
│   rtk-proxy    │  context-db   │    kanwise     │
│  Action organ  │ Memory organ  │ Planning organ │
│                │               │                │
│ 7-layer secure │ SQLite + FTS5 │ Kanban board   │
│ cmd execution  │ Causal chains │ REST + WS +    │
│ Git checkpoint │ Confidence    │ MCP + KBF      │
│ Policy engine  │ Compaction    │ Real-time sync │
└────────────────┴───────────────┴────────────────┘
```

| Crate | Role | Binary |
|-------|------|--------|
| `cortx-types` | Shared types + organ traits | — |
| `rtk-proxy` | Secure command execution (policy, sandbox, budget, circuit breaker) | `rtk-proxy` |
| `context-db` | Memory with FTS5 search, causal chains, confidence reinforcement, compaction | `context-db` |
| `kanwise` | AI-native kanban board (REST, WebSocket, MCP, KBF protocol) | `kanwise` |
| `cortx` | Orchestrator wiring all 3 organs | `cortx` |

### How it works

1. **Agent calls `proxy_exec`** — command goes through the 7-layer pipeline (policy → tier → budget → sandbox → execute → output → circuit breaker)
2. **Pre-flight memory** — before monitored/dangerous commands, context-db injects hints from past failures and causal chains
3. **Execution is remembered** — result stored in context-db with files touched, errors, duration
4. **On failure → recall** — context-db searches causal chains for known fix patterns
5. **On success after failure → learn** — a causal chain is created, confidence reinforced
6. **Tasks tracked** — kanwise board keeps the agent's work organized with atomic claiming, quality gates, and escalation

## Quick Start

### From source

```bash
git clone https://github.com/tienedev/cortx.git
cd cortx
cargo build --workspace
```

This produces 4 binaries in `target/debug/`:

```bash
./target/debug/cortx --help       # Orchestrator (meta-MCP + CLI)
./target/debug/rtk-proxy --help   # Command proxy (MCP + CLI)
./target/debug/context-db --help  # Memory organ (MCP + CLI)
./target/debug/kanwise --help     # Kanban board (web server + MCP)
```

### Run the orchestrator

```bash
# Start the meta-MCP server (exposes all 15 tools on stdio)
cortx serve --project . --policy cortx-policy.toml

# Start the web server (kanban board UI on port 3001)
cortx web

# Or run organs individually
rtk-proxy mcp --policy cortx-policy.toml
context-db mcp --db context.db
kanwise --mcp
```

### MCP configuration

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "cortx": {
      "command": "cortx",
      "args": ["serve", "--project", "/path/to/your/project"]
    }
  }
}
```

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `kanwise.db` | Kanwise SQLite database |
| `KANBAN_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3001` | CORS origins |
| `KANBAN_ENV` | — | Set to `production` to enforce security |

The proxy is configured via `cortx-policy.toml` (command tiers, sandbox rules, budget limits).

## MCP Tools

The `cortx serve` meta-MCP exposes 15 tools across all 3 organs:

### Proxy (Action) — 3 tools

| Tool | Description |
|------|-------------|
| `proxy_exec` | Execute a command through the secure 7-layer pipeline (with pre-flight/post-flight memory) |
| `proxy_status` | Budget, execution count, circuit breaker state |
| `proxy_rollback` | Restore last git checkpoint |

### Memory — 3 tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a project fact with citation |
| `memory_recall` | Search memory (FTS5 + confidence ranking) |
| `memory_status` | Execution count, causal chains, DB size |

### Planning — 9 tools

| Tool | Description |
|------|-------------|
| `planning_next_task` | Get next ai-ready task |
| `planning_complete_task` | Mark a task as done |
| `planning_list_tasks` | List tasks with details, labels, lock status |
| `planning_decompose` | Decompose objective into ordered tasks with dependency validation |
| `planning_claim_task` | Atomically claim a task for an agent |
| `planning_release_task` | Release a claimed task back to the pool |
| `planning_validate_gates` | Run quality gates (tests, lint, diff size) |
| `planning_escalate` | Escalate a blocked task with context |
| `session_report` | Generate and store session activity report |

Each organ also runs as a standalone MCP server with its own subset of tools.

## Kanwise Board

The planning organ is a full-featured kanban board with a web UI.

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

### Kanwise MCP tools

When running standalone, kanwise exposes 4 tools:

| Tool | Purpose |
|------|---------|
| `board_query` | Read board state (KBF or JSON) |
| `board_mutate` | Create, update, move, delete entities |
| `board_sync` | Apply KBF deltas, return current state |
| `board_ask` | Natural language queries about the board |

### Features

**Views** — Drag-and-drop kanban, sortable list, Gantt-style timeline

**Rich editing** — Tiptap editor with markdown support

**Custom fields** — Text, number, URL, date fields on any board

**Collaboration** — Real-time CRDT sync (Yjs), live presence, comments, invite links

**Auth** — Argon2 passwords, session tokens, API keys

### Running kanwise standalone

```bash
# Web server (port 3001) + embedded frontend
kanwise

# Docker
docker run -d -p 3001:3001 -v kanwise-data:/data ghcr.io/tienedev/cortx:latest

# MCP only (stdio, no web server)
kanwise --mcp
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum, tokio, SQLite (rusqlite + tokio-rusqlite) |
| Frontend | React 19, TypeScript, Tailwind CSS, shadcn/ui |
| Real-time | Yjs (CRDT), y-websocket |
| MCP | rmcp (Rust MCP library), stdio transport |
| Search | FTS5 (SQLite full-text search) |

## Contributing

```bash
git clone https://github.com/tienedev/cortx.git
cd cortx
make install  # frontend dependencies
make dev      # backend (3001) + frontend (3000) with hot reload
```

```bash
cargo test --workspace                       # run all tests
cargo clippy --workspace -- -D warnings      # lint
```

## License

[MIT](LICENSE)
