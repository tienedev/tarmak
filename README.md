<div align="center">

# Kanwise

**Kanban board for AI-assisted development.**

[Quick Start](#quick-start) · [Architecture](#architecture) · [MCP Server](#mcp-server) · [Features](#features) · [Contributing](#contributing)

</div>

---

Kanwise is a kanban board built for AI-assisted development. It ships as a single Rust binary with a web UI, a WebSocket-based real-time sync engine, and an MCP server that any AI agent can talk to.

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.87+ (auto-installed via `rust-toolchain.toml`) | [rustup.rs](https://rustup.rs) |
| Node.js | 22+ | [nodejs.org](https://nodejs.org) |
| pnpm | 10+ (via corepack) | `corepack enable` |

### From source

```bash
git clone https://github.com/tienedev/kanwise.git
cd kanwise
cp .env.example .env   # configure dev settings
make install           # install frontend dependencies
make dev               # start backend (4000) + agent (9876) + frontend (3000)
```

Open [http://localhost:3000](http://localhost:3000), create an account, and you're in.

### Docker

```bash
docker run -d -p 4000:4000 -v kanwise-data:/data ghcr.io/tienedev/kanwise:latest
```

Or with docker compose:

```bash
docker compose up -d
```

Open [http://localhost:4000](http://localhost:4000). To use a different port:

```bash
PORT=8080 docker compose up -d
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port (also used by Docker) |
| `DATABASE_PATH` | `kanwise.db` | SQLite database path |
| `KANBAN_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:4000` | CORS origins |
| `KANBAN_ENV` | — | Set to `production` to enforce security |
| `KANWISE_EMAIL` | — | Dev only: account email for `make agent` auto-login |
| `KANWISE_PASSWORD` | — | Dev only: account password for `make agent` auto-login |

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

## Architecture

```
crates/
  kanwise/       # Kanban board server (REST + WebSocket + MCP + agent)
  kbf/           # Kanban Bit Format codec
frontend/        # React 19 + TypeScript + Tailwind + shadcn/ui
skills/          # Claude Code plugin (skills, agents, hooks)
```

### Commands

```bash
make dev       # All dev servers (backend 4000 + agent 9876 + frontend 3000)
make back      # Backend only
make front     # Frontend only with HMR
make agent     # Agent server with auto-login (requires .env)
make build     # Production build (frontend + backend)
make clean     # Clean build artifacts
```

### Binaries

| Binary | Purpose |
|--------|---------|
| `kanwise` | Server: `serve`, `agent`, `mcp`, `doctor`, `backup`, `restore`, `export`, `import`, `users`, `reset-password` |

## MCP Server

When running `kanwise mcp`, Kanwise exposes 4 tools over stdio:

| Tool | Purpose |
|------|---------|
| `board_query` | Read board state (KBF or JSON) |
| `board_mutate` | Create, update, move, delete entities |
| `board_sync` | Apply KBF deltas, return current state |
| `board_ask` | Natural language queries about the board |

## Features

### Agent Sessions

Click **Run** on any task card to launch an autopiloted Claude Code session:

- Embedded terminal (xterm.js) streams live output
- Multiple parallel sessions via git worktrees
- Atomic task claiming prevents race conditions
- Agent auto-authenticates using your Kanwise token

### KBF: 95% fewer tokens

**KBF (Kanban Bit Format)** is a compact protocol for AI interactions:

```
# JSON: 2,847 tokens → KBF: 142 tokens (95% reduction)
B|abc-123|Sprint 24
C|col-1|Todo|0
T|task-1|Fix auth bug|high|0
```

### More

- **Views** — Drag-and-drop kanban, sortable list, Gantt-style timeline
- **Rich editing** — Tiptap editor with markdown support
- **Custom fields** — Text, number, URL, date fields on any board
- **Collaboration** — Real-time CRDT sync (Yjs), live presence, comments, invite links
- **i18n** — English and French
- **Auth** — Argon2 passwords, session tokens, API keys

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
cp .env.example .env     # configure dev credentials
make install             # frontend dependencies
make dev                 # backend + agent + frontend with HMR
```

```bash
cargo test --workspace                       # run all tests
cargo clippy --workspace -- -D warnings      # lint
cd frontend && pnpm test                     # frontend unit tests
cd frontend && pnpm e2e                      # Playwright E2E tests
```

## License

[MIT](LICENSE)
