# Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge cortx CLI and kanwise-skills plugin into the kanwise monorepo, renaming cortx to kanwise-cli.

**Architecture:** Copy files from cortx and kanwise-skills into the existing kanwise repo. Extend the Cargo workspace. Crate-wide rename cortx → kanwise-cli. Rewrite detection logic for monorepo layout. Update CI, Makefile, CLAUDE.md.

**Tech Stack:** Rust (Cargo workspace), Markdown/JSON (Claude Code plugin), GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-21-monorepo-migration-design.md`

---

### Task 1: Copy cortx sources into crates/kanwise-cli

**Files:**
- Create: `crates/kanwise-cli/` (entire directory from cortx)

- [ ] **Step 1: Copy cortx crate into kanwise repo**

```bash
cp -r /Users/tiene/Projets/cortx-project/cortx/crates/cortx/ crates/kanwise-cli/
```

- [ ] **Step 2: Verify files are in place**

```bash
ls crates/kanwise-cli/src/
```

Expected: `main.rs lib.rs config.rs hook.rs install.rs detect.rs doctor.rs update.rs clean.rs`

```bash
ls crates/kanwise-cli/tests/
```

Expected: `cli_test.rs hook_test.rs detect_test.rs install_test.rs config_test.rs update_test.rs doctor_test.rs clean_test.rs`

- [ ] **Step 3: Commit**

```bash
git add crates/kanwise-cli/
git commit -m "chore: copy cortx sources into crates/kanwise-cli"
```

---

### Task 2: Copy kanwise-skills into skills/

**Files:**
- Create: `skills/` (from kanwise-skills repo)

- [ ] **Step 1: Copy plugin files**

```bash
mkdir -p skills
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/.claude-plugin skills/
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/skills skills/skills
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/agents skills/
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/hooks skills/hooks-plugin
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/commands skills/
cp -r /Users/tiene/Projets/cortx-project/kanwise-skills/docs skills/docs
cp /Users/tiene/Projets/cortx-project/kanwise-skills/LICENSE skills/
cp /Users/tiene/Projets/cortx-project/kanwise-skills/gemini-extension.json skills/
cp /Users/tiene/Projets/cortx-project/kanwise-skills/GEMINI.md skills/
```

Note: hooks are copied to `skills/hooks-plugin` to avoid confusion with git hooks at repo root level.

- [ ] **Step 2: Merge .gitattributes**

Create `.gitattributes` at repo root with kanwise-skills line-ending rules:

```
# Ensure shell scripts always have LF line endings
*.sh text eol=lf
skills/hooks-plugin/session-start text eol=lf
*.cmd text eol=lf

# Common text files
*.md text eol=lf
*.json text eol=lf
*.js text eol=lf
*.mjs text eol=lf
*.ts text eol=lf

# Binary files
*.png binary
*.jpg binary
*.gif binary
```

- [ ] **Step 3: Update plugin.json repo URLs and keywords**

Edit `skills/.claude-plugin/plugin.json`:
- `"homepage"` → `"https://github.com/tienedev/kanwise"`
- `"repository"` → `"https://github.com/tienedev/kanwise"`
- In `"keywords"` array: replace `"cortx"` with `"kanwise-cli"`

- [ ] **Step 4: Verify file structure**

```bash
ls skills/.claude-plugin/ skills/skills/ skills/agents/ skills/commands/ skills/hooks-plugin/ skills/docs/
```

Expected: plugin.json, marketplace.json in .claude-plugin; 14 skill directories; code-reviewer.md in agents; 3 command files; session-start and hooks.json in hooks-plugin; docs files.

- [ ] **Step 5: Commit**

```bash
git add skills/ .gitattributes
git commit -m "chore: copy kanwise-skills plugin into skills/"
```

---

### Task 3: Extend Cargo workspace and update kanwise-cli Cargo.toml

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/kanwise-cli/Cargo.toml`

- [ ] **Step 1: Add kanwise-cli to workspace members**

Edit `Cargo.toml` at repo root — add `"crates/kanwise-cli"` to members:

```toml
[workspace]
resolver = "2"
members = [
    "crates/kanwise",
    "crates/kanwise-cli",
    "crates/kbf",
]
```

Add `tempfile` to workspace dependencies:

```toml
tempfile = "3"
```

- [ ] **Step 2: Update kanwise-cli Cargo.toml to use workspace deps**

Replace `crates/kanwise-cli/Cargo.toml` with:

```toml
[package]
name = "kanwise-cli"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "kanwise-cli"
path = "src/main.rs"

[dependencies]
clap = { workspace = true }
serde_json = { workspace = true }
regex = { workspace = true }
anyhow = { workspace = true }

[dev-dependencies]
tempfile = { workspace = true }
```

- [ ] **Step 3: Verify workspace compiles (will fail on module paths — expected)**

```bash
cargo check -p kanwise-cli 2>&1 | head -5
```

Expected: errors about `cortx::` module paths. This is expected — rename comes in Task 4.

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml crates/kanwise-cli/Cargo.toml
git commit -m "chore: add kanwise-cli to Cargo workspace"
```

---

### Task 4: Crate-wide rename cortx → kanwise-cli

**Files:**
- Modify: all `.rs` files in `crates/kanwise-cli/src/` and `crates/kanwise-cli/tests/`

This is a bulk rename operation (~180 occurrences across 17 files). Use `sed` for mechanical replacements where possible (e.g. `sed -i '' 's/cortx::/kanwise_cli::/g' crates/kanwise-cli/src/*.rs crates/kanwise-cli/tests/*.rs`). The rename has several categories:

**Module paths:** `cortx::` → `kanwise_cli::` (Rust crate names use underscores)
**Binary references:** `env!("CARGO_BIN_EXE_cortx")` → `env!("CARGO_BIN_EXE_kanwise-cli")`
**CLI name:** `#[command(name = "cortx"` → `#[command(name = "kanwise-cli"`
**Config file:** `"cortx.json"` → `"kanwise-cli.json"`
**Hook commands:** `"cortx hook"` → `"kanwise-cli hook"`, `"cortx exec"` → `"kanwise-cli exec"`
**Function names:** `cortx_config_path` → `cli_config_path`, `detect_cortx_repo` → `detect_cli_repo`, `write_cortx_config` → `write_cli_config`
**Variable names:** `cortx_repo` → `cli_repo`, `cortx_path` → `cli_path`, `cortx_version` → `cli_version`, `cortx_entry` → `cli_entry`
**Struct fields:** `cortx_version` → `cli_version`, `cortx_path` → `cli_path`, `cortx_repo` → `cli_repo`
**JSON keys in configs:** `"cortx"` component key → `"kanwise-cli"`
**User-facing strings:** error messages, help text, println output
**Comments/docs:** update all references

- [ ] **Step 1: Rename module paths in all source files**

In all files under `crates/kanwise-cli/src/` and `crates/kanwise-cli/tests/`:
- Replace `cortx::` → `kanwise_cli::` (these are `use` statements and qualified paths)
- Replace `use cortx::` → `use kanwise_cli::` (test imports)

- [ ] **Step 2: Rename function and variable names**

In `crates/kanwise-cli/src/config.rs`:
- `cortx_config_path` → `cli_config_path`
- `"cortx.json"` → `"kanwise-cli.json"`

In `crates/kanwise-cli/src/detect.rs`:
- `detect_cortx_repo` → `detect_cli_repo`
- Parameter `cortx_repo` → `cli_repo` (in `detect_kanwise` function)

In `crates/kanwise-cli/src/install.rs`:
- `write_cortx_config` → `write_cli_config`
- `detect_and_write_config` parameter `cortx_repo` → `cli_repo`
- All `cortx_repo` variable references → `cli_repo`

In `crates/kanwise-cli/src/doctor.rs`:
- Struct fields: `cortx_version` → `cli_version`, `cortx_path` → `cli_path`

In `crates/kanwise-cli/src/main.rs`:
- All variable names: `cortx_path` → `cli_path`
- Command name: `#[command(name = "cortx"` → `#[command(name = "kanwise-cli"`

- [ ] **Step 3: Rename hook and exec command strings**

In `crates/kanwise-cli/src/hook.rs`:
- `"cortx exec "` → `"kanwise-cli exec "`
- `format!("cortx exec -- {quoted}")` → `format!("kanwise-cli exec -- {quoted}")`

In `crates/kanwise-cli/src/install.rs`:
- `"cortx hook"` → `"kanwise-cli hook"`
- Add migration: recognize `"cortx hook"` as a legacy name to migrate (alongside existing `"token-cleaner hook"`)

In `crates/kanwise-cli/src/doctor.rs`:
- `"cortx hook"` → `"kanwise-cli hook"`

- [ ] **Step 4: Rename JSON component keys**

In `crates/kanwise-cli/src/install.rs`:
- JSON key `"cortx"` in config → `"kanwise-cli"`
- The stale MCP entry removal: check for both `"cortx"` and legacy names

In `crates/kanwise-cli/src/main.rs`:
- Component name comparison: `name == "cortx"` → `name == "kanwise-cli"`

- [ ] **Step 5: Rename user-facing strings**

In `crates/kanwise-cli/src/main.rs`:
- All `eprintln!("cortx ...)` → `eprintln!("kanwise-cli ...)`
- All `println!` messages referencing cortx
- Help text: `"Update cortx"` → `"Update kanwise-cli"`
- `"Component to update (cortx or kanwise)"` → `"Component to update (kanwise-cli or kanwise)"`

In `crates/kanwise-cli/src/update.rs`:
- Error messages: `"cortx.json"` → `"kanwise-cli.json"`
- `"cortx install"` → `"kanwise-cli install"`

In `crates/kanwise-cli/src/doctor.rs`:
- All status/warning messages

- [ ] **Step 6: Update test files**

In all files under `crates/kanwise-cli/tests/`:
- `use cortx::` → `use kanwise_cli::`
- `env!("CARGO_BIN_EXE_cortx")` → `env!("CARGO_BIN_EXE_kanwise-cli")`
- All string assertions with "cortx" → "kanwise-cli"
- Variable names: `cortx_repo` → `cli_repo`, etc.
- JSON test data: `"cortx"` keys → `"kanwise-cli"`
- Function names: `mcp_removes_stale_cortx_serve_entry` → `mcp_removes_stale_cli_serve_entry`, etc.
- Test paths: `Path::new("/proj/cortx")` → `Path::new("/proj/kanwise-cli")`

- [ ] **Step 7: Update comments and documentation**

Scan all files for remaining "cortx" in comments and docstrings. Replace with appropriate "kanwise-cli" references.

- [ ] **Step 8: Verify zero remaining "cortx" references**

```bash
grep -r "cortx" crates/kanwise-cli/ --include="*.rs" | grep -v "// legacy" | wc -l
```

Expected: 0 (or only intentional legacy references like migration checks for old `"cortx hook"` name).

- [ ] **Step 9: Verify compilation**

```bash
cargo check -p kanwise-cli
```

Expected: clean compilation, no errors.

- [ ] **Step 10: Run tests**

```bash
cargo test -p kanwise-cli
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add crates/kanwise-cli/
git commit -m "refactor: rename cortx to kanwise-cli across all source files"
```

---

### Task 5: Add hook migration chain (cortx → kanwise-cli)

**Files:**
- Modify: `crates/kanwise-cli/src/install.rs`
- Modify: `crates/kanwise-cli/tests/install_test.rs`

The existing code migrates `token-cleaner hook` → `cortx hook`. We need to extend this to also migrate `cortx hook` → `kanwise-cli hook`. Also add config file migration (`cortx.json` → `kanwise-cli.json`) and ensure `uninstall_hook` recognizes all three legacy names.

- [ ] **Step 1: Write failing test for cortx → kanwise-cli migration**

Add test in `crates/kanwise-cli/tests/install_test.rs`:

```rust
#[test]
fn install_migrates_cortx_hook_to_kanwise_cli() {
    let dir = tempfile::tempdir().unwrap();
    // Pre-populate settings with old "cortx hook"
    kanwise_cli::config::write_json(
        &dir.path().join("settings.json"),
        &serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Bash", "hooks": [{"type": "command", "command": "cortx hook"}]}
                ]
            }
        }),
    ).unwrap();
    let (hook_status, _) = kanwise_cli::install::install(dir.path(), None).unwrap();
    assert_eq!(hook_status, kanwise_cli::install::HookStatus::Migrated);
    let settings = kanwise_cli::config::read_json(&dir.path().join("settings.json")).unwrap();
    let arr = settings["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr[0]["hooks"][0]["command"], "kanwise-cli hook");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p kanwise-cli -- install_migrates_cortx_hook_to_kanwise_cli
```

Expected: FAIL (the migration logic doesn't recognize "cortx hook" yet as a legacy name)

- [ ] **Step 3: Update install.rs to recognize cortx hook as legacy**

In `crates/kanwise-cli/src/install.rs`, in the `install()` function, add `"cortx hook"` alongside `"token-cleaner hook"` as a recognized legacy hook that gets migrated to `"kanwise-cli hook"`.

The function `has_command_hook` and the migration logic should check for both `"token-cleaner hook"` and `"cortx hook"`.

Also update `has_any_managed_hook()` (used by `uninstall_hook`) to recognize all THREE names: `"kanwise-cli hook"`, `"cortx hook"`, `"token-cleaner hook"`. This ensures `kanwise-cli uninstall` can clean up any legacy hook.

Also update `install_mcp` stale entry removal to check for both `"cortx"` and `"kanwise-cli"` serve entries.

- [ ] **Step 4: Add config file migration**

In `crates/kanwise-cli/src/install.rs`, in the `install()` function, check if `~/.claude/cortx.json` exists and `~/.claude/kanwise-cli.json` does not. If so, rename the file. This mirrors the existing `token-cleaner` → `cortx` migration pattern.

- [ ] **Step 5: Run test to verify it passes**

```bash
cargo test -p kanwise-cli -- install_migrates_cortx_hook_to_kanwise_cli
```

Expected: PASS

- [ ] **Step 6: Run all kanwise-cli tests**

```bash
cargo test -p kanwise-cli
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add crates/kanwise-cli/
git commit -m "feat(kanwise-cli): add cortx → kanwise-cli hook migration"
```

---

### Task 6: Rewrite detect.rs for monorepo layout

**Files:**
- Modify: `crates/kanwise-cli/src/detect.rs`
- Modify: `crates/kanwise-cli/tests/detect_test.rs`

In the monorepo, `detect_cli_repo()` should return the **workspace root** (2 parents up from `CARGO_MANIFEST_DIR` which is `crates/kanwise-cli/`). `detect_kanwise()` no longer needs sibling-repo detection — kanwise is in the same workspace.

- [ ] **Step 1: Update detect_cli_repo**

`detect_cli_repo()` already navigates 2 parents up from CARGO_MANIFEST_DIR. In the monorepo this gives the workspace root, which is also the kanwise repo root. The function is correct but rename to `detect_workspace_root()` for clarity.

- [ ] **Step 2: Simplify detect_kanwise for monorepo**

The sibling-repo heuristic (`cortx_repo.parent().join("kanwise")`) no longer applies. In the monorepo, the workspace root IS the kanwise repo. Rewrite `detect_kanwise()`:

1. **Docker detection (step 1):** The compose file search currently uses `cortx_repo.parent().and_then(|parent| ctx.find_compose_file(&parent.join("kanwise")))`. In monorepo, change to `ctx.find_compose_file(workspace_root)` since docker-compose.yml would be at the workspace root.

2. **Local detection (step 2):** Replace `parent.join("kanwise").join("Cargo.toml")` with `workspace_root.join("crates/kanwise/Cargo.toml")`. Return `ComponentMode::Local { repo: workspace_root.to_path_buf() }`.

3. **Binary-only and NotFound:** remain unchanged.

- [ ] **Step 3: Update detect tests**

Update test paths and assertions in `crates/kanwise-cli/tests/detect_test.rs` to reflect monorepo layout. The mock should create `crates/kanwise/Cargo.toml` relative to the test root.

- [ ] **Step 4: Run tests**

```bash
cargo test -p kanwise-cli -- detect
```

Expected: all detect tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/kanwise-cli/
git commit -m "refactor(kanwise-cli): adapt detect.rs for monorepo layout"
```

---

### Task 7: Simplify update.rs for single-repo model

**Files:**
- Modify: `crates/kanwise-cli/src/update.rs`
- Modify: `crates/kanwise-cli/src/main.rs` (update command handling)
- Modify: `crates/kanwise-cli/tests/update_test.rs`

The old model had 2 separate repos with separate `git pull` + `cargo install` per component. In the monorepo: one `git pull`, then `cargo install -p kanwise` and/or `cargo install -p kanwise-cli`.

- [ ] **Step 1: Define new config schema**

The old `kanwise-cli.json` had separate component entries:
```json
{"components": {"cortx": {"mode": "local", "repo": "/path/cortx"}, "kanwise": {"mode": "local", "repo": "/path/kanwise"}}}
```

New schema — single workspace entry:
```json
{"workspace": {"repo": "/path/to/kanwise"}, "kanwise": {"mode": "local"}, "kanwise-cli": {"mode": "local"}}
```

Both components share the same repo path since they're in the same workspace.

- [ ] **Step 2: Rewrite run_update**

Rewrite `run_update()` to:
1. Read `kanwise-cli.json` for the `workspace.repo` path
2. Run `git pull` once in the workspace root
3. For each requested component (`kanwise`, `kanwise-cli`): run `cargo install --path crates/<name>` from the workspace root

Remove the per-component repo path resolution. The function signature stays the same but the internal logic simplifies from iterating separate repos to one repo with multiple crate paths.

- [ ] **Step 3: Update write_cli_config in install.rs**

Update the `write_cli_config()` function to write the new schema format. The `detect_and_write_config()` function should set `workspace.repo` to the workspace root path.

- [ ] **Step 4: Update main.rs update command**

Update `cmd_update()` in main.rs — the `--set-repo` flag now sets `workspace.repo` instead of per-component repos. The component list is still `["kanwise", "kanwise-cli"]` but they share one repo.

- [ ] **Step 5: Update tests**

Rewrite `crates/kanwise-cli/tests/update_test.rs` for the new single-repo model. Test JSON should use the new schema with `workspace.repo`.

- [ ] **Step 6: Run tests**

```bash
cargo test -p kanwise-cli
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add crates/kanwise-cli/
git commit -m "refactor(kanwise-cli): simplify update.rs for monorepo model"
```

---

### Task 8: Merge CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Merge cortx documentation into CLAUDE.md**

Read the existing CLAUDE.md and add a new section for kanwise-cli. The merged structure:

```markdown
# Kanwise

(existing content: Architecture, Commands, Binary, MCP Server, Key patterns, Testing)

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
```

Also include the "Key Patterns" section from the cortx CLAUDE.md (atomic writes, anti-recursion, `read_json` behavior).

Update the Architecture section to include `kanwise-cli` and `skills/`.

Update the main.rs plugin marketplace instructions if they reference `tienedev/kanwise-skills` — they should point to the new monorepo path.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: merge cortx CLI docs into CLAUDE.md"
```

---

### Task 9: Update Makefile and CI

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/backend.yml`

- [ ] **Step 1: Add cli target to Makefile**

Add after the `clean` target:

```makefile
# Build kanwise-cli
cli:
	$(CARGO) build -p kanwise-cli
```

Update `.PHONY` line to include `cli`.

- [ ] **Step 2: Add kanwise-cli smoke test to CI**

In `.github/workflows/backend.yml`, in the `build` job, after the existing `./target/debug/kanwise --help` line, add:

```yaml
      - name: Verify binaries
        run: |
          ./target/debug/kanwise --help
          ./target/debug/kanwise-cli --help
```

- [ ] **Step 3: Commit**

```bash
git add Makefile .github/workflows/backend.yml
git commit -m "chore: add kanwise-cli to Makefile and CI"
```

---

### Task 10: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full workspace check**

```bash
cargo check --workspace
```

Expected: clean, no errors.

- [ ] **Step 2: Run full workspace tests**

```bash
cargo test --workspace
```

Expected: all tests pass (kanwise + kanwise-cli + kbf).

- [ ] **Step 3: Run fmt check**

```bash
cargo fmt --check
```

Expected: no formatting issues. If any, run `cargo fmt` and commit.

- [ ] **Step 4: Run clippy**

```bash
cargo clippy --workspace -- -D warnings
```

Expected: no warnings.

- [ ] **Step 5: Sweep for remaining "cortx" references**

```bash
grep -r "cortx" crates/kanwise-cli/ --include="*.rs" | grep -v "legacy\|migration\|token-cleaner"
```

Expected: 0 results (only intentional legacy migration references should remain).

- [ ] **Step 6: Verify kanwise-cli binary works**

```bash
cargo run -p kanwise-cli -- --help
```

Expected: shows help with command name `kanwise-cli`.

- [ ] **Step 7: Verify frontend still builds**

```bash
cd frontend && corepack pnpm run build
```

Expected: builds successfully.

- [ ] **Step 8: Verify make cli works**

```bash
make cli
```

Expected: builds kanwise-cli successfully.

- [ ] **Step 9: Commit any remaining fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address final verification issues"
```

---

### Task 11: Post-migration cleanup (deferred)

These items are done manually after the migration is verified and merged:

- [ ] **Step 1:** Archive `cortx` and `kanwise-skills` repos on GitHub
- [ ] **Step 2:** Update plugin marketplace URL if users installed from the old `kanwise-skills` repo
- [ ] **Step 3:** Remove the `cortx-project/` parent directory wrapper
- [ ] **Step 4:** Verify `.mcp.json.example` at repo root has no cortx references
