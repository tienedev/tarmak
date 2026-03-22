# Rename Kanwise → Tarmak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the entire project from "kanwise"/"Kanwise" to "tarmak"/"Tarmak" across all crates, frontend, config, CI/CD, docs, and skills.

**Architecture:** Mechanical rename in dependency order — Rust crate first (foundation), then build config, env vars, frontend, CI/CD, docs, skills, and finally GitHub repo. Each task must leave the build in a working state.

**Tech Stack:** Rust (Cargo workspace), React/TypeScript, Docker, GitHub Actions, Claude Code skills plugin

**Rename mapping:**
| From | To | Context |
|------|----|---------|
| `kanwise` | `tarmak` | crate name, binary, directories, paths, service names |
| `Kanwise` | `Tarmak` | display name, titles, UI text, struct names |
| `KANWISE` | `TARMAK` | environment variables |
| `KANBAN_` | `TARMAK_` | environment variables (KANBAN_ALLOWED_ORIGINS, etc.) |
| `kanwise-skills` | `tarmak-skills` | plugin package name |
| `ghcr.io/tienedev/kanwise` | `ghcr.io/tienedev/tarmak` | Docker image |
| `tienedev/kanwise` | `tienedev/tarmak` | GitHub repo |

**Note:** `Cargo.lock` will be regenerated automatically by `cargo build` after the crate rename. It must be committed with the changes.

---

### Task 1: Rename Rust crate directory and Cargo workspace

The foundation — everything else depends on the crate name.

**Files:**
- Rename: `crates/kanwise/` → `crates/tarmak/`
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/tarmak/Cargo.toml` (package + binary name)

- [ ] **Step 1: Rename the crate directory**

```bash
git mv crates/kanwise crates/tarmak
```

Use `git mv` to preserve file history tracking.

- [ ] **Step 2: Update workspace root Cargo.toml**

In `Cargo.toml`, change the workspace member:
```toml
members = ["crates/tarmak", "crates/kbf"]
```

- [ ] **Step 3: Update crate Cargo.toml**

In `crates/tarmak/Cargo.toml`, change:
```toml
[package]
name = "tarmak"

[[bin]]
name = "tarmak"
```

- [ ] **Step 4: Verify workspace resolves**

Run: `cargo metadata --no-deps --format-version 1 | head -5`
Expected: no errors, metadata output

---

### Task 2: Rename all Rust source references

Every `use kanwise::`, `kanwise::`, and `Kanwise` struct in the source code and tests.

**Files:**
- Modify: `crates/tarmak/src/main.rs`
- Modify: `crates/tarmak/src/lib.rs` (includes `pub struct Kanwise` → `pub struct Tarmak`)
- Modify: `crates/tarmak/src/cli.rs`
- Modify: `crates/tarmak/src/server.rs`
- Modify: `crates/tarmak/src/agent/token.rs`
- Modify: `crates/tarmak/src/agent/repo_cache.rs`
- Modify: `crates/tarmak/src/agent/pty.rs`
- Modify: `crates/tarmak/src/agent/server.rs`
- Modify: `crates/tarmak/src/mcp/sse.rs`
- Modify: `crates/tarmak/tests/claim_test.rs`
- Modify: `crates/tarmak/tests/planning_organ_test.rs`
- Modify: `crates/tarmak/tests/decompose_test.rs`

- [ ] **Step 1: Rename `pub struct Kanwise` to `pub struct Tarmak` in lib.rs**

Also rename `impl Kanwise` → `impl Tarmak`, and update all associated methods/references. Change `.join(".kanwise")` → `.join(".tarmak")` and `kanwise.db` → `tarmak.db`.

- [ ] **Step 2: Rename all `use kanwise::` imports in main.rs**

Replace all `use kanwise::` with `use tarmak::` and all `kanwise::` qualified paths with `tarmak::`. Replace `Kanwise` struct references with `Tarmak`.

- [ ] **Step 3: Rename CLI command name in main.rs**

Change `#[command(name = "kanwise"` to `#[command(name = "tarmak"`.
Change MCP server info `"name": "kanwise"` to `"name": "tarmak"`.

- [ ] **Step 4: Rename in server.rs**

Change `"Starting kanwise"` → `"Starting tarmak"` and any other references.

- [ ] **Step 5: Rename data directory references**

In `agent/token.rs`: change `.join(".kanwise")` → `.join(".tarmak")`.
In `agent/repo_cache.rs`: change `.join(".kanwise")` → `.join(".tarmak")`.
In `agent/pty.rs`: change `kanwise-sessions` → `tarmak-sessions`.

- [ ] **Step 6: Rename user-facing strings**

In `cli.rs`: change `kanwise-backup-` → `tarmak-backup-`.
In `agent/server.rs`: change all user-facing "kanwise" references to "tarmak" (help text, command examples, comments).
In `mcp/sse.rs`: change `"kanwise".to_string()` → `"tarmak".to_string()`.

- [ ] **Step 7: Rename in integration tests**

In `tests/claim_test.rs`: replace `use kanwise::` → `use tarmak::`, `Kanwise::` → `Tarmak::`.
In `tests/planning_organ_test.rs`: same replacements.
In `tests/decompose_test.rs`: same replacements.

- [ ] **Step 8: Sweep for any remaining references**

Run: `rg -i 'kanwise' crates/` to catch anything missed.

- [ ] **Step 9: Build the workspace**

Run: `cargo build --workspace`
Expected: successful build

- [ ] **Step 10: Run all tests**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 11: Run clippy**

Run: `cargo clippy --workspace -- -D warnings`
Expected: no warnings

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: rename kanwise crate to tarmak"
```

---

### Task 3: Rename environment variables

Rename all `KANWISE_*` and `KANBAN_*` env vars to `TARMAK_*`.

**Files:**
- Modify: `.env.example`
- Modify: `.env`
- Modify: `Makefile` (env var references)
- Modify: `crates/tarmak/src/server.rs` (`KANBAN_ALLOWED_ORIGINS`)
- Modify: `crates/tarmak/src/api/attachments.rs` (`KANBAN_UPLOADS_DIR`, `KANBAN_MAX_UPLOAD_SIZE`)
- Modify: `crates/tarmak/src/mcp/tools.rs` (`KANBAN_UPLOADS_DIR`)
- Modify: any other Rust source reading `KANWISE_*` or `KANBAN_*` env vars

- [ ] **Step 1: Find all env var reads**

Run: `rg 'KANWISE_|KANBAN_' crates/` to find all env var reads.

- [ ] **Step 2: Rename KANWISE_* env vars in Rust source**

Replace `KANWISE_EMAIL` → `TARMAK_EMAIL`, `KANWISE_PASSWORD` → `TARMAK_PASSWORD`, `KANWISE_TOKEN` → `TARMAK_TOKEN`.

- [ ] **Step 3: Rename KANBAN_* env vars in Rust source**

Replace `KANBAN_ALLOWED_ORIGINS` → `TARMAK_ALLOWED_ORIGINS`, `KANBAN_ENV` → `TARMAK_ENV`, `KANBAN_UPLOADS_DIR` → `TARMAK_UPLOADS_DIR`, `KANBAN_MAX_UPLOAD_SIZE` → `TARMAK_MAX_UPLOAD_SIZE`.

- [ ] **Step 4: Rename env vars in .env.example and .env**

Replace all `KANWISE_` → `TARMAK_` and `KANBAN_` → `TARMAK_` prefixes.

- [ ] **Step 5: Rename env vars in Makefile**

Replace `KANWISE_EMAIL` → `TARMAK_EMAIL`, `KANWISE_PASSWORD` → `TARMAK_PASSWORD`.

- [ ] **Step 6: Build and test**

Run: `cargo build --workspace && cargo test --workspace`
Expected: pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename KANWISE/KANBAN env vars to TARMAK"
```

---

### Task 4: Rename build and deploy config

**Files:**
- Modify: `Makefile`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `build.sh`
- Modify: `.mcp.json.example`

- [ ] **Step 1: Update Makefile**

Replace all `--bin kanwise` → `--bin tarmak`.
Replace all `target/debug/kanwise` → `target/debug/tarmak`.
Replace all `target/release/kanwise` → `target/release/tarmak`.
Replace `pkill -f "target/debug/kanwise"` → `pkill -f "target/debug/tarmak"`.
Replace `pkill -f "target/release/kanwise"` → `pkill -f "target/release/tarmak"`.

- [ ] **Step 2: Update Dockerfile**

Replace `target/release/kanwise` → `target/release/tarmak`.
Replace `CMD ["kanwise", "serve"]` → `CMD ["tarmak", "serve"]`.
Replace binary copy destination: `/usr/local/bin/kanwise` → `/usr/local/bin/tarmak`.

- [ ] **Step 3: Update docker-compose.yml**

Change service name from `kanwise:` to `tarmak:`.
Change volume name `kanwise-data:` → `tarmak-data:` (both in service and volume definition).
Change `DATABASE_PATH=/data/kanwise.db` → `DATABASE_PATH=/data/tarmak.db`.
Update image reference if present.
Update commented `KANBAN_ALLOWED_ORIGINS` line (now `TARMAK_ALLOWED_ORIGINS`).

- [ ] **Step 4: Update build.sh**

Replace `target/release/kanwise` → `target/release/tarmak`.

- [ ] **Step 5: Update .mcp.json.example**

Replace `"kanwise"` server name and `"command": "kanwise"` with `"tarmak"`.

- [ ] **Step 6: Verify make build works**

Run: `make build`
Expected: successful build producing `target/release/tarmak` binary

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename kanwise to tarmak in build config"
```

---

### Task 5: Rename frontend references

**Files:**
- Modify: `frontend/index.html` (page title)
- Modify: `frontend/src/index.css` (comment)
- Modify: `frontend/src/layouts/AppLayout.tsx` (brand name in sidebar)
- Modify: `frontend/src/i18n/index.ts` (localStorage key)
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/fr.json`
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/e2e/dashboard.spec.ts` ("Welcome to Kanwise")
- Modify: `frontend/e2e/board.spec.ts` ("Welcome to Kanwise")

- [ ] **Step 1: Update page title**

In `frontend/index.html`: change `<title>Kanwise</title>` → `<title>Tarmak</title>`.

- [ ] **Step 2: Update brand name in sidebar**

In `frontend/src/layouts/AppLayout.tsx`: change all "Kanwise" text to "Tarmak".

- [ ] **Step 3: Update CSS comment**

In `frontend/src/index.css`: change `KANWISE` → `TARMAK` in the design system comment.

- [ ] **Step 4: Update localStorage key**

In `frontend/src/i18n/index.ts`: replace `'kanwise-language'` → `'tarmak-language'`.

- [ ] **Step 5: Update English i18n strings**

In `en.json`: replace "kanwise agent" and "Kanwise" references with "tarmak agent" and "Tarmak".

- [ ] **Step 6: Update French i18n strings**

In `fr.json`: replace "kanwise agent" and "Kanwise" references with "tarmak agent" and "Tarmak".

- [ ] **Step 7: Update playwright config**

Replace `--bin kanwise` → `--bin tarmak`.

- [ ] **Step 8: Update E2E tests**

In `frontend/e2e/dashboard.spec.ts`: change `'Welcome to Kanwise'` → `'Welcome to Tarmak'`.
In `frontend/e2e/board.spec.ts`: change `'Welcome to Kanwise'` → `'Welcome to Tarmak'`.

- [ ] **Step 9: Sweep for any other frontend references**

Run: `rg -i 'kanwise' frontend/src/ frontend/e2e/ frontend/index.html` to catch anything missed.

- [ ] **Step 10: Verify frontend builds**

Run: `cd frontend && pnpm build`
Expected: successful build

- [ ] **Step 11: Run frontend tests**

Run: `cd frontend && pnpm test`
Expected: all tests pass

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: rename kanwise to tarmak in frontend"
```

---

### Task 6: Rename CI/CD workflows

**Files:**
- Modify: `.github/workflows/backend.yml`
- Modify: `.github/workflows/e2e.yml`

Note: `deploy.yml` uses `${{ github.repository }}` dynamically — no hardcoded kanwise references. The repo rename (Task 9) handles it automatically.

- [ ] **Step 1: Update backend.yml**

Replace `kanwise` binary references and comments with `tarmak`.

- [ ] **Step 2: Update e2e.yml**

Replace `kanwise` binary references with `tarmak`.
Replace `kanwise-e2e.db` → `tarmak-e2e.db` in the DATABASE_PATH.
Update step names (e.g., "Start kanwise" → "Start tarmak").

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: rename kanwise to tarmak in workflows"
```

---

### Task 7: Rename documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `LICENSE`
- Modify: `docs/superpowers/specs/2026-03-22-readme-design.md`
- Modify: `docs/superpowers/plans/2026-03-21-monorepo-migration.md`
- Modify: `docs/superpowers/specs/2026-03-21-monorepo-migration-design.md`

- [ ] **Step 1: Update README.md**

Replace all "Kanwise"/"kanwise" with "Tarmak"/"tarmak".
Update GitHub URLs: `tienedev/kanwise` → `tienedev/tarmak`.
Update Docker image: `ghcr.io/tienedev/kanwise` → `ghcr.io/tienedev/tarmak`.

- [ ] **Step 2: Update CLAUDE.md**

Replace all "Kanwise"/"kanwise" with "Tarmak"/"tarmak".
Update binary name, crate references, MCP section.

- [ ] **Step 3: Update LICENSE**

Replace `Copyright (c) 2026 Kanwise` → `Copyright (c) 2026 Tarmak`.

- [ ] **Step 4: Update planning docs**

Replace references in `docs/superpowers/specs/2026-03-22-readme-design.md`.
Replace references in `docs/superpowers/plans/2026-03-21-monorepo-migration.md`.
Replace references in `docs/superpowers/specs/2026-03-21-monorepo-migration-design.md`.

- [ ] **Step 5: Sweep for any other docs**

Run: `rg -i 'kanwise' docs/ README.md CLAUDE.md LICENSE` to catch anything missed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: rename kanwise to tarmak"
```

---

### Task 8: Rename skills plugin

**Files:**
- Modify: `skills/.claude-plugin/plugin.json`
- Modify: `skills/.claude-plugin/marketplace.json`
- Modify: `skills/skills/writing-plans/SKILL.md`
- Modify: `skills/skills/subagent-driven-development/SKILL.md`
- Modify: `skills/skills/finishing-a-development-branch/SKILL.md`

- [ ] **Step 1: Update plugin.json**

Replace `"kanwise-skills"` → `"tarmak-skills"`.
Replace repository URLs: `tienedev/kanwise` → `tienedev/tarmak`.
Replace description references.

- [ ] **Step 2: Update marketplace.json**

Replace `"tienedev-kanwise-skills"` → `"tienedev-tarmak-skills"`.
Replace `"kanwise-skills"` → `"tarmak-skills"`.
Replace description references.

- [ ] **Step 3: Update skill files**

In all SKILL.md files, replace:
- `kanwise board` → `tarmak board`
- `kanwise MCP` → `tarmak MCP`
- `kanwise_task_id` → `tarmak_task_id`
- `kanwise not connected` → `tarmak not connected`
- Any other kanwise references.

- [ ] **Step 4: Sweep for any other skill references**

Run: `rg -i 'kanwise' skills/` to catch everything.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename kanwise-skills to tarmak-skills"
```

---

### Task 9: Rename GitHub repo and Docker registry

This is the final step — it's destructive and affects all remote URLs.

**External changes (manual or via gh CLI):**
- Rename GitHub repo: `tienedev/kanwise` → `tienedev/tarmak`
- Create new Docker package on ghcr.io

- [ ] **Step 1: Rename GitHub repo**

```bash
gh repo rename tarmak
```

GitHub will set up a redirect from the old name automatically.

- [ ] **Step 2: Update local git remote**

```bash
git remote set-url origin https://github.com/tienedev/tarmak.git
```

- [ ] **Step 3: Update repo description**

```bash
gh repo edit tienedev/tarmak --description "The developer's kanban board — built for humans and AI agents"
```

Topics carry over automatically from the rename.

- [ ] **Step 4: Push all changes**

```bash
git push origin main
```

- [ ] **Step 5: Close superseded PR #47**

```bash
gh pr close 47 --comment "Superseded by rename — README changes included in the rename branch."
```

- [ ] **Step 6: Verify**

- Visit https://github.com/tienedev/tarmak
- Verify redirect from old URL works
- Verify CI workflows trigger
- Verify Docker image builds on next release tag

---

### Post-rename checklist

- [ ] **Data directory migration**: Add a one-time migration in `lib.rs` that moves `~/.kanwise/` → `~/.tarmak/` if the old directory exists. This prevents data loss for existing users.
- [ ] **Existing `.env` files**: Developers with local `.env` files will need to rename `KANWISE_*` and `KANBAN_*` vars to `TARMAK_*` manually.
- [ ] **Rename project directory on disk**: `mv ~/Projets/kanwise ~/Projets/tarmak` (affects Claude Code project memory path).
- [ ] Update any external references (website, social media, etc.)
