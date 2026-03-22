# Kanwise

The developer's kanban board — built for humans and AI agents.

[![Backend](https://github.com/tienedev/kanwise/actions/workflows/backend.yml/badge.svg)](https://github.com/tienedev/kanwise/actions/workflows/backend.yml)
[![Frontend](https://github.com/tienedev/kanwise/actions/workflows/frontend.yml/badge.svg)](https://github.com/tienedev/kanwise/actions/workflows/frontend.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-kanwise-blue)](https://ghcr.io/tienedev/kanwise)

<!-- Screenshot coming soon — board view with an agent session running in the terminal drawer -->

AI-assisted development is powerful but locked behind the terminal. Kanwise gives the whole team — PMs, designers, developers — a kanban interface to pilot AI agents like Claude Code. Click "Run" on a task, watch the agent work in a live terminal, get production-quality code.

## Features

### For everyone

- **Agent sessions** — click "Run" on any task, Claude Code executes in an embedded terminal
- **Multiple views** — drag-and-drop kanban, sortable list, Gantt-style timeline, sessions
- **Real-time collaboration** — CRDT sync (Yjs) with live presence
- **Multi-user** — role-based access (Owner, Member, Viewer), board sharing via invite links
- **Rich editing** — Tiptap-based markdown editor
- **Custom fields**, labels, subtasks, comments, attachments, notifications
- **i18n** — English and French

### For AI agents

- **MCP server** — stdio and SSE transports, 4 tools (query, mutate, sync, ask)
- **KBF** (Kanban Bit Format) — compact token-efficient format for AI communication
- **Atomic task claiming** — advisory locks prevent race conditions between agents
- **Skills plugin** — Claude Code integration with brainstorming, planning, TDD, debugging, code review workflows
- **Natural language queries** — "what's overdue?", "unassigned tasks", board stats

### For ops

- **Single binary** — Rust, serves frontend, API, WebSocket, and MCP
- **SQLite** — zero external dependencies, file-based persistence
- **Docker** — multi-stage build, published to ghcr.io/tienedev/kanwise
- **Self-hosted** — your data stays on your infrastructure
- **CLI** — backup/restore, export/import, user management

## Quick Start

### Docker

```bash
docker run -d --name kanwise \
  -p 4000:4000 \
  -v kanwise-data:/data \
  ghcr.io/tienedev/kanwise:latest
```

Or with docker compose:

```bash
docker compose up -d
```

Open [http://localhost:4000](http://localhost:4000), create an account, and you're in.

### From source

```bash
git clone https://github.com/tienedev/kanwise.git
cd kanwise
cp .env.example .env
make install  # install frontend dependencies
make dev      # starts backend (4000) + agent (9876) + frontend (3000)
```

Open [http://localhost:3000](http://localhost:3000). Requires [rustup](https://rustup.rs/) and [pnpm](https://pnpm.io/).

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

| Tool | Purpose |
|------|---------|
| `board_query` | Read board state (KBF or JSON) |
| `board_mutate` | Create, update, move, delete entities |
| `board_sync` | Apply KBF deltas, return current state |
| `board_ask` | Natural language queries about the board |

## Architecture

```
crates/
  kanwise/       Kanban server — REST, WebSocket, MCP, agent, CLI
  kbf/           Kanban Bit Format codec
frontend/        React 19 + TypeScript + Tailwind + shadcn/ui
skills/          Claude Code plugin — skills, agents, hooks
```

| Layer | Stack |
|-------|-------|
| Backend | Rust, Tokio, Axum, SQLite |
| Frontend | React 19, TypeScript, Vite, Tailwind, shadcn/ui |
| Real-time | Yjs (CRDT) over WebSocket |
| AI | MCP (rmcp), KBF, xterm.js |
| Agent | Rust, PTY, git worktrees |

## Contributing

### Prerequisites

- [Rust](https://rustup.rs/) (channel set by `rust-toolchain.toml`)
- [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/)

### Setup

```bash
cp .env.example .env
make install
make dev
```

### Commands

| Command | Description |
|---------|-------------|
| `make dev` | Start all dev servers |
| `make back` | Backend only |
| `make front` | Frontend with HMR |
| `make agent` | Agent server |
| `make build` | Production build |
| `make clean` | Clean all build artifacts |
| `make kill` | Kill running dev processes |
| `cargo test --workspace` | Run all Rust tests |
| `cargo clippy --workspace -- -D warnings` | Lint Rust |
| `cd frontend && pnpm test` | Frontend unit tests |
| `cd frontend && pnpm lint` | Frontend lint |

### Testing

- **Integration tests** — `crates/kanwise/tests/`, uses `Db::in_memory()` for database tests
- **Frontend unit tests** — Vitest (`cd frontend && pnpm test`)
- **E2E** — Playwright (`cd frontend && npx playwright test`), requires backend running

See [CLAUDE.md](CLAUDE.md) for detailed codebase patterns and conventions.

## License

[MIT](LICENSE)
