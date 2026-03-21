# Kanwise

Kanban board for AI-assisted development. Monorepo with 3 Rust crates, a React frontend, and a Claude Code skills plugin.

## Architecture

```
crates/
  kanwise/       # Kanban board (REST + WebSocket + MCP server + agent)
  kanwise-cli/   # Claude Code dev-environment configurator (hooks, MCP, plugin)
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
cargo test --workspace  # Run all tests
cargo clippy --workspace -- -D warnings  # Lint
cargo build --workspace  # Build
cargo install --path crates/kanwise-cli  # Install kanwise-cli binary
```

## Binary

| Binary | Purpose |
|--------|---------|
| `kanwise` | Kanban board server — web server (`serve`), agent server (`agent`), MCP server (`mcp`), CLI (`doctor`, `backup`, `restore`, `export`, `import`, `users`, `reset-password`) |
| `kanwise-cli` | Configure Claude Code dev environment — hooks, MCP servers, plugin instructions |

## MCP Server (kanwise mcp)

Stdio-based MCP server using `rmcp` with `ServerHandler` trait.

## Key patterns

- `tokio-rusqlite` for async SQLite — `db.with_conn(move |conn| { ... }).await`
- Atomic task claiming with advisory locks (`locked_by`, `locked_at`)
- CRDT sync via Yrs (Yjs Rust port) over WebSocket
- KBF (Kanban Bit Format) for compact board serialization
- Atomic JSON writes via temp file + rename (`config::write_json`)
- Anti-recursion guard in hook: skip commands already prefixed with `kanwise-cli exec`
- `config::read_json` returns `{}` for missing files, errors on malformed JSON
- `serde_json::Value` as the universal config type (no typed structs for Claude settings)

## Kanwise CLI (crates/kanwise-cli)

Configure Claude Code dev environment — hooks, MCP servers, plugins.

### CLI Commands

```
kanwise-cli install       Configure Claude Code (hooks + MCP + plugin instructions)
kanwise-cli uninstall     Remove kanwise-cli configuration from Claude Code
kanwise-cli doctor        Check configuration status
kanwise-cli hook          PreToolUse hook handler (stdin JSON → stdout JSON)
kanwise-cli exec -- CMD   Execute CMD and clean its output
kanwise-cli update        Update kanwise and/or kanwise-cli to latest version
```

### CLI Modules

| Module | Responsibility |
|--------|---------------|
| `clean.rs` | Output cleaning pipeline (strip ANSI, dedup blanks, strip progress) |
| `hook.rs` | PreToolUse hook JSON rewrite (anti-recursion + token-cleaner) |
| `config.rs` | Read/write `~/.claude/settings.json` and `.mcp.json` (atomic writes) |
| `install.rs` | Install/uninstall hooks + MCP kanwise config |
| `doctor.rs` | Diagnostic checks (binary, hook, MCP, plugin) |
| `detect.rs` | Auto-detection of workspace root, docker containers, install modes |
| `update.rs` | Update logic: git pull, cargo install |

## Skills Plugin (skills/)

Claude Code plugin with skills, agents, hooks, and commands. Installed via marketplace.

## Testing

- Integration tests in `crates/kanwise/tests/`
- Use `Db::in_memory()` for DB tests (no file needed)
- `tempfile::TempDir` + `git init` for git-dependent tests
- kanwise-cli integration tests in `crates/kanwise-cli/tests/`
- kanwise-cli tests use `tempfile::TempDir` for isolated config directories
