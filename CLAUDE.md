# Cortx

AI development orchestrator. Monorepo with 5 Rust crates + React frontend.

## Architecture

```
crates/
  cortx-types/   # Shared types + organ traits (PlanningOrgan, ActionOrgan, MemoryOrgan)
  kanwise/       # Planning organ — kanban board (REST + WebSocket + MCP)
  rtk-proxy/     # Action organ — secure 7-layer command execution pipeline
  context-db/    # Memory organ — SQLite + FTS5, causal chains, confidence reinforcement + compaction
  cortx/         # Orchestrator — wires all 3 organs, meta-MCP server (15 tools)
kbf/             # Kanban Bit Format codec (standalone crate)
frontend/        # React 19 + TypeScript + Tailwind + shadcn/ui
```

## Commands

```bash
make install          # Install frontend dependencies
make dev              # Start dev servers (backend port 3001, frontend port 3000)
cargo test --workspace  # Run all tests
cargo clippy --workspace -- -D warnings  # Lint
cargo build --workspace  # Build all 4 binaries
```

## Binaries

| Binary | Purpose |
|--------|---------|
| `cortx` | Unified orchestrator — meta-MCP server (`serve`), web server (`web`), CLI (`doctor`, `backup`, `restore`, `export`, `import`, `users`, `reset-password`) |
| `kanwise` | Kanban board server (REST + WS + MCP) — also runnable standalone |
| `rtk-proxy` | Secure command proxy (CLI + MCP) |
| `context-db` | Memory organ (CLI + MCP) |

## MCP Tools (cortx serve)

### Proxy (3)
`proxy_exec`, `proxy_status`, `proxy_rollback`

### Memory (3)
`memory_store`, `memory_recall`, `memory_status`

### Planning (9)
`planning_next_task`, `planning_complete_task`, `planning_list_tasks`, `planning_decompose`, `planning_claim_task`, `planning_release_task`, `planning_validate_gates`, `planning_escalate`, `session_report`

## Key patterns

- All MCP servers use `rmcp` with `ServerHandler` trait + stdio transport
- `tokio-rusqlite` for async SQLite — `db.with_conn(move |conn| { ... }).await`
- Organ traits in cortx-types are `async fn in trait` (no dyn dispatch)
- Policy-based command classification: Safe → Monitored → Dangerous → Forbidden
- Bidirectional confidence: reinforcement on success (+0.15), decay on churn, penalty on failure (-0.20)
- Pre-flight memory: orchestrator checks context-db before monitored/dangerous commands
- Quality gates configured via `cortx-gates.toml` (tests, lint, diff size)
- Atomic task claiming with advisory locks (`locked_by`, `locked_at`)

## Testing

- Integration tests per crate in `crates/*/tests/`
- Use `tempfile::TempDir` + `git init` for git-dependent tests
- `ContextDb::in_memory()` and `Db::in_memory()` for DB tests (no file needed)
- `Orchestrator::without_kanwise()` for orchestrator tests without real kanwise DB

## Gotchas

- `Tier::as_str()` returns lowercase (`"safe"`, `"monitored"`, etc.) — used in DB storage
- `Memory::CausalChain` requires `trigger_command: Option<String>` field
- MCP `call_tool` cannot use `?` on `Result<_, String>` — use explicit `return Ok(CallToolResult::error(...))`
- `kanwise::Db::new(path)` creates OR opens the DB (no separate `open` method)
