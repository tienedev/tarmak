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
│   ├── commands/
│   └── docs/            # Plugin integration docs (Codex, OpenCode, etc.)
├── docs/
├── Cargo.toml           # Unified workspace (3 crates)
├── Cargo.lock
├── Makefile
├── CLAUDE.md            # Merged (kanwise + cortx docs)
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
- `tempfile` (add as workspace dev-dependency)

All 4 runtime deps already exist in the kanwise workspace.

### 2. Rename cortx → kanwise-cli

**Scope:** This is a crate-wide rename (~80+ occurrences of "cortx" across all source files). Not just a few surgical replacements.

- Copy `cortx/crates/cortx/` → `kanwise/crates/kanwise-cli/`
- Update `Cargo.toml`: `name = "kanwise-cli"`
- Rename across ALL source files:
  - Function names: `detect_cortx_repo` → `detect_cli_repo`, `cortx_config_path`, etc.
  - `hook.rs`: anti-recursion check (`cortx exec` → `kanwise-cli exec`, plus existing `token-cleaner` chain)
  - `install.rs`: hook command registration, migration chain (`token-cleaner` OR `cortx hook` → `kanwise-cli hook`)
  - `update.rs`: binary name, repo reference
  - `config.rs`: config file path (`cortx.json` → `kanwise-cli.json`)
  - `detect.rs`: `detect_cortx_repo()` uses `CARGO_MANIFEST_DIR` at compile time — must be updated for new path inside monorepo. `detect_kanwise()` sibling-repo heuristic (`cortx_repo.parent().join("kanwise")`) no longer applies — in monorepo, CLI is inside kanwise, so detection simplifies to navigating to workspace root.
  - `main.rs` / CLI help text, binary name references

**Config migration:** `cortx.json` → `kanwise-cli.json`. The install command must migrate existing `cortx.json` files (same pattern already used for `token-cleaner` → `cortx` migration).

**Hook migration chain:** `token-cleaner hook` OR `cortx hook` → `kanwise-cli hook`. The `install_hook()` function already handles one generation of migration; extend it to recognize both old names.

### 3. Plugin (skills/)

- Copy `kanwise-skills/` contents → `kanwise/skills/`
- **Keep:** `.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `commands/`, `docs/`
- **Keep:** `gemini-extension.json`, `GEMINI.md` (Gemini Code Assist integration)
- **Keep:** `LICENSE` (MIT, keep for attribution of original superpowers fork)
- **Drop:** `.git/`, `target/`, `README.md` (redundant with root)
- **Merge:** `.gitattributes` line-ending rules into kanwise root `.gitattributes`
- Update `plugin.json` path references and repo URL
- `marketplace.json` stays in `skills/.claude-plugin/`

### 4. CLAUDE.md

Merge both CLAUDE.md files into one at the repo root. Structure:

```markdown
# Kanwise

## Architecture
(existing kanwise architecture section + skills/ and marketplace)

## Kanwise CLI (crates/kanwise-cli)
(cortx CLI docs: commands, modules, key patterns)

## Commands
(merged: kanwise server commands + kanwise-cli commands)
```

### 5. CI/CD

- Keep existing `.github/workflows/` from kanwise
- `cargo test --workspace` already tests all crate members — no test changes
- Add smoke test for `kanwise-cli` binary: `./target/debug/kanwise-cli --help`
- Add `tempfile` to workspace dev-dependencies for kanwise-cli tests

### 6. Makefile

Add target:
```makefile
cli:  ## Build kanwise-cli
	cargo build -p kanwise-cli
```

### 7. .mcp.json

The `.mcp.json` is gitignored in kanwise (user-local config). The `.mcp.json.example` stays as a reference. The `cortx-project/.mcp.json` at the parent level becomes irrelevant once the parent directory is removed.

## Execution Order

1. Copy files (cortx sources → `crates/kanwise-cli/`, kanwise-skills → `skills/`)
2. Update Cargo workspace to include `kanwise-cli`
3. Crate-wide rename `cortx` → `kanwise-cli` (all source files, config paths, detection logic)
4. Fix `detect.rs` and `update.rs` for monorepo layout
5. Merge CLAUDE.md
6. Update Makefile and CI
7. Verify: `cargo test --workspace`, `cargo clippy --workspace`

## What Does NOT Change

- `crates/kanwise/` source code — zero modifications
- `crates/kbf/` — zero modifications
- `frontend/` — zero modifications
- Skills markdown content — zero modifications
- API endpoints, agent server, MCP server behavior

## Post-Migration Cleanup

1. Archive `cortx` and `kanwise-skills` repos on GitHub
2. Update `update.rs` in kanwise-cli to use single-repo update model (one `git pull`, then `cargo install` per crate)
3. Update plugin marketplace URL if users installed from the old kanwise-skills repo
4. Remove the `cortx-project/` parent directory wrapper
5. Migrate existing user configs: `cortx.json` → `kanwise-cli.json` (handled by install command)

## Risks

- **Plugin installation path**: Users who installed kanwise-skills from the old repo URL will need to reinstall. Marketplace URL in plugin.json must point to the new location (`kanwise` repo, `skills/` subdirectory).
- **Binary rename**: Anyone with `cortx` in their PATH or scripts will need to update to `kanwise-cli`. The install command handles migration of config files and hook entries.
- **Fork upstream**: Superpowers upstream sync is intentionally severed. Future upstream changes must be manually cherry-picked if desired.
- **Detection logic**: `detect.rs` assumes multi-repo layout (sibling directories). Must be rewritten for monorepo where CLI and server share one workspace root.

## Rollback

If the migration fails partway through, delete `crates/kanwise-cli/` and `skills/` from the kanwise repo and start over. The source repos are untouched until the final archival step.
