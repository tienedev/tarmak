# Kanwise

Kanban board for AI-assisted development. Monorepo with 2 Rust crates + React frontend.

## Architecture

```
crates/
  kanwise/   # Kanban board (REST + WebSocket + MCP server)
  kbf/       # Kanban Bit Format codec
frontend/    # React 19 + TypeScript + Tailwind + shadcn/ui
```

## Commands

```bash
make install          # Install frontend dependencies
make dev              # Start dev servers (backend port 3001, frontend port 3000)
cargo test --workspace  # Run all tests
cargo clippy --workspace -- -D warnings  # Lint
cargo build --workspace  # Build
```

## Binary

| Binary | Purpose |
|--------|---------|
| `kanwise` | Kanban board server — web server (`serve`), MCP server (`mcp`), CLI (`doctor`, `backup`, `restore`, `export`, `import`, `users`, `reset-password`) |

## MCP Server (kanwise mcp)

Stdio-based MCP server using `rmcp` with `ServerHandler` trait.

## Key patterns

- `tokio-rusqlite` for async SQLite — `db.with_conn(move |conn| { ... }).await`
- Atomic task claiming with advisory locks (`locked_by`, `locked_at`)
- CRDT sync via Yrs (Yjs Rust port) over WebSocket
- KBF (Kanban Bit Format) for compact board serialization

## Testing

- Integration tests in `crates/kanwise/tests/`
- Use `Db::in_memory()` for DB tests (no file needed)
- `tempfile::TempDir` + `git init` for git-dependent tests
