# README Design Spec

## Purpose

Write a high-quality README for the Kanwise project that serves as both a showcase for potential users and a guide for contributors. The tone is technical, sober, and well-structured — no emojis, no prose, let the features speak.

## Target Audience

- **Primary**: Developers, PMs, and designers evaluating Kanwise as a tool
- **Secondary**: Open-source contributors wanting to participate

## Language

English.

## Structure

### 1. Header

- Project name: **Kanwise**
- Tagline: "The developer's kanban board — built for humans and AI agents"
- Badges: CI status (backend, frontend), license (MIT), Docker image (ghcr.io)
- Hero image placeholder: `<!-- screenshot coming soon -->` with a note describing what it will show (board view with agent session running in terminal drawer)

### 2. Pitch (2-3 sentences)

Core message:
- AI-assisted development is powerful but locked behind the terminal
- Kanwise gives the whole team — PMs, designers, developers — a kanban interface to pilot AI agents like Claude Code
- Click "Run" on a task, watch the agent work in a live terminal, get production-quality code

Keep it concise. No marketing fluff.

### 3. Features — 3 sections

Organized by audience, not by technology. Short descriptions, no paragraphs.

**For everyone**
- Agent sessions — click "Run" on any task, Claude Code executes in an embedded terminal (xterm.js)
- Multiple views — drag-and-drop kanban, sortable list, Gantt-style timeline, sessions
- Real-time collaboration — CRDT sync (Yjs) with live presence
- Multi-user — role-based access (Owner, Member, Viewer), board sharing via invite links
- Rich editing — Tiptap-based markdown editor
- Custom fields, labels, subtasks, comments, attachments, notifications
- i18n — English and French

**For AI agents**
- MCP server — stdio and SSE transports, 4 tools (query, mutate, sync, ask)
- KBF (Kanban Bit Format) — compact token-efficient format for AI communication
- Atomic task claiming — advisory locks prevent race conditions between agents
- Skills plugin — Claude Code integration with brainstorming, planning, TDD, debugging, code review workflows
- Natural language queries — "what's overdue?", "unassigned tasks", board stats

**For ops**
- Single Rust binary — serves frontend, API, WebSocket, and MCP
- SQLite — zero external dependencies, file-based persistence
- Docker — multi-stage build, published to ghcr.io/tienedev/kanwise
- Self-hosted — your data stays on your infrastructure
- Backup/restore, export/import, user management CLI

### 4. Quick Start

Two paths:

**Docker (recommended)**
```bash
docker run -d --name kanwise \
  -p 4000:4000 \
  -v kanwise-data:/data \
  ghcr.io/tienedev/kanwise:latest
```

**From source**
```bash
git clone https://github.com/tienedev/kanwise.git
cd kanwise
make install  # install frontend dependencies
make dev      # starts backend (4000) + agent (9876) + frontend (3000)
```

Note: requires Rust toolchain and pnpm.

### 5. Architecture

Brief monorepo overview with a text diagram:

```
crates/
  kanwise/       Kanban server — REST, WebSocket, MCP, agent, CLI
  kbf/           Kanban Bit Format codec
frontend/        React 19 + TypeScript + Tailwind + shadcn/ui
skills/          Claude Code plugin — skills, agents, hooks
```

Tech stack as a compact table:

| Layer | Stack |
|-------|-------|
| Backend | Rust, Tokio, Axum, SQLite |
| Frontend | React 19, TypeScript, Vite, Tailwind, shadcn/ui |
| Real-time | Yjs (CRDT) over WebSocket |
| AI | MCP (rmcp), KBF, xterm.js |
| Agent | Rust, PTY, git worktrees |

### 6. Contributing

**Prerequisites**
- Rust via rustup (channel set by rust-toolchain.toml)
- Node.js 22+ and pnpm

**Development setup**
```bash
cp .env.example .env
make install
make dev
```

**Commands reference** — compact table:

| Command | Description |
|---------|-------------|
| `make dev` | Start all dev servers |
| `make back` | Backend only |
| `make front` | Frontend with HMR |
| `make agent` | Agent server |
| `make build` | Production build |
| `cargo test --workspace` | Run all Rust tests |
| `cargo clippy --workspace -- -D warnings` | Lint Rust |
| `cd frontend && pnpm test` | Frontend unit tests |
| `cd frontend && pnpm lint` | Frontend lint |
| `make clean` | Clean all build artifacts |
| `make kill` | Kill running dev processes |

**Testing**
- Integration tests: `crates/kanwise/tests/`
- Use `Db::in_memory()` for database tests
- E2E: Playwright (`cd frontend && npx playwright test`, needs backend running)

**Project structure** — brief description of each crate/directory, pointing to CLAUDE.md for detailed patterns.

### 7. License

MIT — one line with link to LICENSE file.

## Design Decisions

- **No emojis** — technical, sober tone
- **Features grouped by audience** — makes it scannable for different readers
- **Quick Start before Architecture** — users want to try it before understanding internals
- **Contributing at the bottom** — secondary audience, doesn't clutter the top
- **Hero image placeholder** — WIP, will be added later
- **No "Table of Contents"** — the README is short enough to scroll
- **English only** — international reach, consistent with codebase language

## What's explicitly excluded

- Detailed API documentation (belongs in separate docs)
- Full environment variable reference (belongs in .env.example or docs)
- Changelog (separate CHANGELOG.md)
- Code of conduct (separate file if needed)
- Detailed MCP tool documentation (separate docs)
