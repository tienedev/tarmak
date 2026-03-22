# Tarmak

Kanban board for AI-assisted development. Monorepo with 2 Rust crates, a React frontend, and a Claude Code skills plugin.

## Architecture

```
crates/
  tarmak/        # Kanban board (REST + WebSocket + MCP server + agent)
  kbf/           # Kanban Bit Format codec
frontend/        # React 19 + TypeScript + Tailwind + shadcn/ui
skills/          # Claude Code plugin (skills, agents, hooks, commands)
```

## Commands

```bash
make install          # Install frontend dependencies
make dev              # Start all dev servers (backend 4000 + agent 9876 + frontend 3000)
make back             # Backend only
make front            # Frontend only with HMR
make agent            # Agent server with auto-login
make build            # Production build (frontend + backend)
make clean            # Clean all build artifacts
make kill             # Kill running dev processes
cargo test --workspace  # Run all Rust tests
cargo clippy --workspace -- -D warnings  # Lint Rust
cargo build --workspace  # Build all crates
cd frontend && pnpm test       # Frontend unit tests (vitest)
cd frontend && pnpm lint       # Frontend lint (eslint)
cd frontend && npx playwright test  # E2E tests (needs backend running)
```

## Binary

| Binary | Purpose |
|--------|---------|
| `tarmak` | Kanban board server — web server (`serve`), agent server (`agent`), MCP server (`mcp`), CLI (`doctor`, `backup`, `restore`, `export`, `import`, `users`, `reset-password`) |

## MCP Server (tarmak mcp)

Stdio-based MCP server using `rmcp` with `ServerHandler` trait.

## Key patterns

- `tokio-rusqlite` for async SQLite — `db.with_conn(move |conn| { ... }).await`
- Atomic task claiming with advisory locks (`locked_by`, `locked_at`)
- CRDT sync via Yrs (Yjs Rust port) over WebSocket
- KBF (Kanban Bit Format) for compact board serialization
## Skills Plugin (skills/)

Claude Code plugin with skills, agents, hooks, and commands. Installed via marketplace.

## Environment

Copy `.env.example` to `.env`. `TARMAK_EMAIL` / `TARMAK_PASSWORD` are needed for `make agent` auto-login.

## Testing

- Integration tests in `crates/tarmak/tests/`
- Use `Db::in_memory()` for DB tests (no file needed)
- `tempfile::TempDir` + `git init` for git-dependent tests
- E2E tests in `frontend/e2e/` — Playwright auto-starts backend via `cargo run`
