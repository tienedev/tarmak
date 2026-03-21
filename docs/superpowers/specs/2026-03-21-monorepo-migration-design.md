# Monorepo Migration Design

**Date:** 2026-03-21
**Status:** Approved

## Goal

Merge 3 repositories (`kanwise`, `cortx`, `kanwise-skills`) into a single `kanwise` monorepo. Clean slate — files are copied, git history is not preserved for cortx and kanwise-skills.

## Current State

| Repo | Purpose | Tech |
|------|---------|------|
| `kanwise` (GitHub) | Kanban board server + React frontend | Rust (axum, tokio-rusqlite) + React 19 |
| `cortx` (GitHub) | Claude Code environment configurator CLI | Rust (clap, serde_json) |
| `kanwise-skills` (GitHub) | Claude Code plugin: skills, agents, hooks | Markdown + JSON (fork of obra/superpowers) |

Three separate git repos living under a non-git `cortx-project/` parent directory.

## Target Structure

```
kanwise/
├── crates/
│   ├── kanwise/        # Server (REST + WS + MCP + agent) — unchanged
│   ├── kanwise-cli/    # CLI config/install (renamed from cortx)
│   └── kbf/            # Kanban Bit Format codec — unchanged
├── frontend/            # React 19 + TypeScript — unchanged
├── skills/              # Claude Code plugin (from kanwise-skills)
│   ├── .claude-plugin/
│   │   ├── plugin.json
│   │   └── marketplace.json
│   ├── skills/
│   ├── agents/
│   ├── hooks/
│   └── commands/
├── docs/
├── Cargo.toml           # Unified workspace (3 crates)
├── Cargo.lock
├── Makefile
├── CLAUDE.md            # Merged (kanwise + cortx docs)
├── .mcp.json
└── .github/workflows/
```

## Changes Required

### 1. Cargo Workspace

Extend the existing `kanwise/Cargo.toml` workspace:

```toml
[workspace]
members = ["crates/kanwise", "crates/kanwise-cli", "crates/kbf"]
```

Add cortx's dependencies to `[workspace.dependencies]`:
- `clap` (already present)
- `serde_json` (already present)
- `regex` (already present)
- `anyhow` (already present)

All 4 deps already exist in the kanwise workspace — no new dependencies needed.

### 2. Rename cortx → kanwise-cli

- Copy `cortx/crates/cortx/` → `kanwise/crates/kanwise-cli/`
- Update `Cargo.toml`: `name = "kanwise-cli"`
- Update binary references in source code:
  - `hook.rs`: anti-recursion check (`cortx exec` → `kanwise-cli exec`)
  - `install.rs`: hook command registration
  - `update.rs`: binary name for self-update
  - `main.rs` / `cli.rs`: help text, binary name
  - Any string literals referencing "cortx"
- Dev dependency `tempfile` is already in kanwise workspace

### 3. Plugin (skills/)

- Copy `kanwise-skills/` contents → `kanwise/skills/`
- Exclude: `.git/`, `target/`, `README.md` (if redundant)
- Keep: `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `commands/`, `docs/`
- Update `plugin.json` if it contains path references
- `marketplace.json` stays in `skills/.claude-plugin/`

### 4. CLAUDE.md

Merge both CLAUDE.md files into one at the repo root. Structure:

```markdown
# Kanwise

## Architecture
(existing kanwise architecture section)

## Kanwise CLI (crates/kanwise-cli)
(cortx CLI docs: commands, modules, key patterns)

## Commands
(merged: kanwise server commands + kanwise-cli commands)
```

### 5. CI/CD

- Keep existing `.github/workflows/` from kanwise
- Add `kanwise-cli` to the Rust CI job in `backend.yml` (it already runs `cargo test --workspace`)
- No changes needed since workspace already tests all members

### 6. Makefile

Add target:
```makefile
cli:  ## Build kanwise-cli
	cargo build -p kanwise-cli
```

### 7. .mcp.json

Move to repo root (already there in practice). No content changes.

## What Does NOT Change

- `crates/kanwise/` source code — zero modifications
- `crates/kbf/` — zero modifications
- `frontend/` — zero modifications
- Skills markdown content — zero modifications
- API endpoints, agent server, MCP server behavior
- GitHub Actions workflows (they already use `--workspace`)

## Post-Migration Cleanup

1. Archive `cortx` and `kanwise-skills` repos on GitHub
2. Update `update.rs` in kanwise-cli to reference the kanwise repo
3. Update plugin marketplace URL if users installed from the old kanwise-skills repo
4. Remove the `cortx-project/` parent directory wrapper

## Risks

- **Plugin installation path**: Users who installed kanwise-skills from the old repo URL will need to reinstall. Marketplace URL in plugin.json must point to the new location (`kanwise` repo, `skills/` subdirectory).
- **Binary rename**: Anyone with `cortx` in their PATH or scripts will need to update to `kanwise-cli`. The install command should handle this.
- **Fork upstream**: Superpowers upstream sync is intentionally severed. Future upstream changes must be manually cherry-picked if desired.
