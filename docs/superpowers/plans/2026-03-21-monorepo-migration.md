# Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge cortx CLI and tarmak-skills plugin into the tarmak monorepo, renaming cortx to tarmak-cli.

**Architecture:** Copy files from cortx and tarmak-skills into the existing tarmak repo. Extend the Cargo workspace. Crate-wide rename cortx → tarmak-cli. Rewrite detection logic for monorepo layout. Update CI, Makefile, CLAUDE.md.

**Tech Stack:** Rust (Cargo workspace), Markdown/JSON (Claude Code plugin), GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-21-monorepo-migration-design.md`

---

### Task 1: Copy cortx sources into crates/tarmak-cli

**Files:**
- Create: `crates/tarmak-cli/` (entire directory from cortx)

- [ ] **Step 1: Copy cortx crate into tarmak repo**

```bash
cp -r /Users/tiene/Projets/cortx-project/cortx/crates/cortx/ crates/tarmak-cli/
```

- [ ] **Step 2: Verify files are in place**

```bash
ls crates/tarmak-cli/src/
```

Expected: `main.rs lib.rs config.rs hook.rs install.rs detect.rs doctor.rs update.rs clean.rs`

```bash
ls crates/tarmak-cli/tests/
```

Expected: `cli_test.rs hook_test.rs detect_test.rs install_test.rs config_test.rs update_test.rs doctor_test.rs clean_test.rs`

- [ ] **Step 3: Commit**

```bash
git add crates/tarmak-cli/
git commit -m "chore: copy cortx sources into crates/tarmak-cli"
```

---

### Task 2: Copy tarmak-skills into skills/

**Files:**
- Create: `skills/` (from tarmak-skills repo)

- [ ] **Step 1: Copy plugin files**

```bash
mkdir -p skills
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/.claude-plugin skills/
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/skills skills/skills
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/agents skills/
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/hooks skills/hooks-plugin
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/commands skills/
cp -r /Users/tiene/Projets/cortx-project/tarmak-skills/docs skills/docs
cp /Users/tiene/Projets/cortx-project/tarmak-skills/LICENSE skills/
cp /Users/tiene/Projets/cortx-project/tarmak-skills/gemini-extension.json skills/
cp /Users/tiene/Projets/cortx-project/tarmak-skills/GEMINI.md skills/
```

Note: hooks are copied to `skills/hooks-plugin` to avoid confusion with git hooks at repo root level.

- [ ] **Step 2: Merge .gitattributes**

Create `.gitattributes` at repo root with tarmak-skills line-ending rules:

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
- `"homepage"` → `"https://github.com/tienedev/tarmak"`
- `"repository"` → `"https://github.com/tienedev/tarmak"`
- In `"keywords"` array: replace `"cortx"` with `"tarmak-cli"`

- [ ] **Step 4: Verify file structure**

```bash
ls skills/.claude-plugin/ skills/skills/ skills/agents/ skills/commands/ skills/hooks-plugin/ skills/docs/
```

Expected: plugin.json, marketplace.json in .claude-plugin; 14 skill directories; code-reviewer.md in agents; 3 command files; session-start and hooks.json in hooks-plugin; docs files.

- [ ] **Step 5: Commit**

```bash
git add skills/ .gitattributes
git commit -m "chore: copy tarmak-skills plugin into skills/"
```

---

### Task 3: Extend Cargo workspace and update tarmak-cli Cargo.toml

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/tarmak-cli/Cargo.toml`

- [ ] **Step 1: Add tarmak-cli to workspace members**

Edit `Cargo.toml` at repo root — add `"crates/tarmak-cli"` to members:

```toml
[workspace]
resolver = "2"
members = [
    "crates/tarmak",
    "crates/tarmak-cli",
    "crates/kbf",
]
```

Add `tempfile` to workspace dependencies:

```toml
tempfile = "3"
```

- [ ] **Step 2: Update tarmak-cli Cargo.toml to use workspace deps**

Replace `crates/tarmak-cli/Cargo.toml` with:

```toml
[package]
name = "tarmak-cli"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "tarmak-cli"
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
cargo check -p tarmak-cli 2>&1 | head -5
```

Expected: errors about `cortx::` module paths. This is expected — rename comes in Task 4.

- [ ] **Step 4: Commit**

```bash
git add Cargo.toml crates/tarmak-cli/Cargo.toml
git commit -m "chore: add tarmak-cli to Cargo workspace"
```

---

### Task 4: Crate-wide rename cortx → tarmak-cli

**Files:**
- Modify: all `.rs` files in `crates/tarmak-cli/src/` and `crates/tarmak-cli/tests/`

This is a bulk rename operation (~180 occurrences across 17 files). Use `sed` for mechanical replacements where possible (e.g. `sed -i '' 's/cortx::/tarmak_cli::/g' crates/tarmak-cli/src/*.rs crates/tarmak-cli/tests/*.rs`). The rename has several categories:

**Module paths:** `cortx::` → `tarmak_cli::` (Rust crate names use underscores)
**Binary references:** `env!("CARGO_BIN_EXE_cortx")` → `env!("CARGO_BIN_EXE_tarmak-cli")`
**CLI name:** `#[command(name = "cortx"` → `#[command(name = "tarmak-cli"`
**Config file:** `"cortx.json"` → `"tarmak-cli.json"`
**Hook commands:** `"cortx hook"` → `"tarmak-cli hook"`, `"cortx exec"` → `"tarmak-cli exec"`
**Function names:** `cortx_config_path` → `cli_config_path`, `detect_cortx_repo` → `detect_cli_repo`, `write_cortx_config` → `write_cli_config`
**Variable names:** `cortx_repo` → `cli_repo`, `cortx_path` → `cli_path`, `cortx_version` → `cli_version`, `cortx_entry` → `cli_entry`
**Struct fields:** `cortx_version` → `cli_version`, `cortx_path` → `cli_path`, `cortx_repo` → `cli_repo`
**JSON keys in configs:** `"cortx"` component key → `"tarmak-cli"`
**User-facing strings:** error messages, help text, println output
**Comments/docs:** update all references

- [ ] **Step 1: Rename module paths in all source files**

In all files under `crates/tarmak-cli/src/` and `crates/tarmak-cli/tests/`:
- Replace `cortx::` → `tarmak_cli::` (these are `use` statements and qualified paths)
- Replace `use cortx::` → `use tarmak_cli::` (test imports)

- [ ] **Step 2: Rename function and variable names**

In `crates/tarmak-cli/src/config.rs`:
- `cortx_config_path` → `cli_config_path`
- `"cortx.json"` → `"tarmak-cli.json"`

In `crates/tarmak-cli/src/detect.rs`:
- `detect_cortx_repo` → `detect_cli_repo`
- Parameter `cortx_repo` → `cli_repo` (in `detect_tarmak` function)

In `crates/tarmak-cli/src/install.rs`:
- `write_cortx_config` → `write_cli_config`
- `detect_and_write_config` parameter `cortx_repo` → `cli_repo`
- All `cortx_repo` variable references → `cli_repo`

In `crates/tarmak-cli/src/doctor.rs`:
- Struct fields: `cortx_version` → `cli_version`, `cortx_path` → `cli_path`

In `crates/tarmak-cli/src/main.rs`:
- All variable names: `cortx_path` → `cli_path`
- Command name: `#[command(name = "cortx"` → `#[command(name = "tarmak-cli"`

- [ ] **Step 3: Rename hook and exec command strings**

In `crates/tarmak-cli/src/hook.rs`:
- `"cortx exec "` → `"tarmak-cli exec "`
- `format!("cortx exec -- {quoted}")` → `format!("tarmak-cli exec -- {quoted}")`

In `crates/tarmak-cli/src/install.rs`:
- `"cortx hook"` → `"tarmak-cli hook"`
- Add migration: recognize `"cortx hook"` as a legacy name to migrate (alongside existing `"token-cleaner hook"`)

In `crates/tarmak-cli/src/doctor.rs`:
- `"cortx hook"` → `"tarmak-cli hook"`

- [ ] **Step 4: Rename JSON component keys**

In `crates/tarmak-cli/src/install.rs`:
- JSON key `"cortx"` in config → `"tarmak-cli"`
- The stale MCP entry removal: check for both `"cortx"` and legacy names

In `crates/tarmak-cli/src/main.rs`:
- Component name comparison: `name == "cortx"` → `name == "tarmak-cli"`

- [ ] **Step 5: Rename user-facing strings**

In `crates/tarmak-cli/src/main.rs`:
- All `eprintln!("cortx ...)` → `eprintln!("tarmak-cli ...)`
- All `println!` messages referencing cortx
- Help text: `"Update cortx"` → `"Update tarmak-cli"`
- `"Component to update (cortx or tarmak)"` → `"Component to update (tarmak-cli or tarmak)"`

In `crates/tarmak-cli/src/update.rs`:
- Error messages: `"cortx.json"` → `"tarmak-cli.json"`
- `"cortx install"` → `"tarmak-cli install"`

In `crates/tarmak-cli/src/doctor.rs`:
- All status/warning messages

- [ ] **Step 6: Update test files**

In all files under `crates/tarmak-cli/tests/`:
- `use cortx::` → `use tarmak_cli::`
- `env!("CARGO_BIN_EXE_cortx")` → `env!("CARGO_BIN_EXE_tarmak-cli")`
- All string assertions with "cortx" → "tarmak-cli"
- Variable names: `cortx_repo` → `cli_repo`, etc.
- JSON test data: `"cortx"` keys → `"tarmak-cli"`
- Function names: `mcp_removes_stale_cortx_serve_entry` → `mcp_removes_stale_cli_serve_entry`, etc.
- Test paths: `Path::new("/proj/cortx")` → `Path::new("/proj/tarmak-cli")`

- [ ] **Step 7: Update comments and documentation**

Scan all files for remaining "cortx" in comments and docstrings. Replace with appropriate "tarmak-cli" references.

- [ ] **Step 8: Verify zero remaining "cortx" references**

```bash
grep -r "cortx" crates/tarmak-cli/ --include="*.rs" | grep -v "// legacy" | wc -l
```

Expected: 0 (or only intentional legacy references like migration checks for old `"cortx hook"` name).

- [ ] **Step 9: Verify compilation**

```bash
cargo check -p tarmak-cli
```

Expected: clean compilation, no errors.

- [ ] **Step 10: Run tests**

```bash
cargo test -p tarmak-cli
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add crates/tarmak-cli/
git commit -m "refactor: rename cortx to tarmak-cli across all source files"
```

---

### Task 5: Add hook migration chain (cortx → tarmak-cli)

**Files:**
- Modify: `crates/tarmak-cli/src/install.rs`
- Modify: `crates/tarmak-cli/tests/install_test.rs`

The existing code migrates `token-cleaner hook` → `cortx hook`. We need to extend this to also migrate `cortx hook` → `tarmak-cli hook`. Also add config file migration (`cortx.json` → `tarmak-cli.json`) and ensure `uninstall_hook` recognizes all three legacy names.

- [ ] **Step 1: Write failing test for cortx → tarmak-cli migration**

Add test in `crates/tarmak-cli/tests/install_test.rs`:

```rust
#[test]
fn install_migrates_cortx_hook_to_tarmak_cli() {
    let dir = tempfile::tempdir().unwrap();
    // Pre-populate settings with old "cortx hook"
    tarmak_cli::config::write_json(
        &dir.path().join("settings.json"),
        &serde_json::json!({
            "hooks": {
                "PreToolUse": [
                    {"matcher": "Bash", "hooks": [{"type": "command", "command": "cortx hook"}]}
                ]
            }
        }),
    ).unwrap();
    let (hook_status, _) = tarmak_cli::install::install(dir.path(), None).unwrap();
    assert_eq!(hook_status, tarmak_cli::install::HookStatus::Migrated);
    let settings = tarmak_cli::config::read_json(&dir.path().join("settings.json")).unwrap();
    let arr = settings["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr[0]["hooks"][0]["command"], "tarmak-cli hook");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cargo test -p tarmak-cli -- install_migrates_cortx_hook_to_tarmak_cli
```

Expected: FAIL (the migration logic doesn't recognize "cortx hook" yet as a legacy name)

- [ ] **Step 3: Update install.rs to recognize cortx hook as legacy**

In `crates/tarmak-cli/src/install.rs`, in the `install()` function, add `"cortx hook"` alongside `"token-cleaner hook"` as a recognized legacy hook that gets migrated to `"tarmak-cli hook"`.

The function `has_command_hook` and the migration logic should check for both `"token-cleaner hook"` and `"cortx hook"`.

Also update `has_any_managed_hook()` (used by `uninstall_hook`) to recognize all THREE names: `"tarmak-cli hook"`, `"cortx hook"`, `"token-cleaner hook"`. This ensures `tarmak-cli uninstall` can clean up any legacy hook.

Also update `install_mcp` stale entry removal to check for both `"cortx"` and `"tarmak-cli"` serve entries.

- [ ] **Step 4: Add config file migration**

In `crates/tarmak-cli/src/install.rs`, in the `install()` function, check if `~/.claude/cortx.json` exists and `~/.claude/tarmak-cli.json` does not. If so, rename the file. This mirrors the existing `token-cleaner` → `cortx` migration pattern.

- [ ] **Step 5: Run test to verify it passes**

```bash
cargo test -p tarmak-cli -- install_migrates_cortx_hook_to_tarmak_cli
```

Expected: PASS

- [ ] **Step 6: Run all tarmak-cli tests**

```bash
cargo test -p tarmak-cli
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add crates/tarmak-cli/
git commit -m "feat(tarmak-cli): add cortx → tarmak-cli hook migration"
```

---

### Task 6: Rewrite detect.rs for monorepo layout

**Files:**
- Modify: `crates/tarmak-cli/src/detect.rs`
- Modify: `crates/tarmak-cli/tests/detect_test.rs`

In the monorepo, `detect_cli_repo()` should return the **workspace root** (2 parents up from `CARGO_MANIFEST_DIR` which is `crates/tarmak-cli/`). `detect_tarmak()` no longer needs sibling-repo detection — tarmak is in the same workspace.

- [ ] **Step 1: Update detect_cli_repo**

`detect_cli_repo()` already navigates 2 parents up from CARGO_MANIFEST_DIR. In the monorepo this gives the workspace root, which is also the tarmak repo root. The function is correct but rename to `detect_workspace_root()` for clarity.

- [ ] **Step 2: Simplify detect_tarmak for monorepo**

The sibling-repo heuristic (`cortx_repo.parent().join("tarmak")`) no longer applies. In the monorepo, the workspace root IS the tarmak repo. Rewrite `detect_tarmak()`:

1. **Docker detection (step 1):** The compose file search currently uses `cortx_repo.parent().and_then(|parent| ctx.find_compose_file(&parent.join("tarmak")))`. In monorepo, change to `ctx.find_compose_file(workspace_root)` since docker-compose.yml would be at the workspace root.

2. **Local detection (step 2):** Replace `parent.join("tarmak").join("Cargo.toml")` with `workspace_root.join("crates/tarmak/Cargo.toml")`. Return `ComponentMode::Local { repo: workspace_root.to_path_buf() }`.

3. **Binary-only and NotFound:** remain unchanged.

- [ ] **Step 3: Update detect tests**

Update test paths and assertions in `crates/tarmak-cli/tests/detect_test.rs` to reflect monorepo layout. The mock should create `crates/tarmak/Cargo.toml` relative to the test root.

- [ ] **Step 4: Run tests**

```bash
cargo test -p tarmak-cli -- detect
```

Expected: all detect tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/tarmak-cli/
git commit -m "refactor(tarmak-cli): adapt detect.rs for monorepo layout"
```

---

### Task 7: Simplify update.rs for single-repo model

**Files:**
- Modify: `crates/tarmak-cli/src/update.rs`
- Modify: `crates/tarmak-cli/src/main.rs` (update command handling)
- Modify: `crates/tarmak-cli/tests/update_test.rs`

The old model had 2 separate repos with separate `git pull` + `cargo install` per component. In the monorepo: one `git pull`, then `cargo install -p tarmak` and/or `cargo install -p tarmak-cli`.

- [ ] **Step 1: Define new config schema**

The old `tarmak-cli.json` had separate component entries:
```json
{"components": {"cortx": {"mode": "local", "repo": "/path/cortx"}, "tarmak": {"mode": "local", "repo": "/path/tarmak"}}}
```

New schema — single workspace entry:
```json
{"workspace": {"repo": "/path/to/tarmak"}, "tarmak": {"mode": "local"}, "tarmak-cli": {"mode": "local"}}
```

Both components share the same repo path since they're in the same workspace.

- [ ] **Step 2: Rewrite run_update**

Rewrite `run_update()` to:
1. Read `tarmak-cli.json` for the `workspace.repo` path
2. Run `git pull` once in the workspace root
3. For each requested component (`tarmak`, `tarmak-cli`): run `cargo install --path crates/<name>` from the workspace root

Remove the per-component repo path resolution. The function signature stays the same but the internal logic simplifies from iterating separate repos to one repo with multiple crate paths.

- [ ] **Step 3: Update write_cli_config in install.rs**

Update the `write_cli_config()` function to write the new schema format. The `detect_and_write_config()` function should set `workspace.repo` to the workspace root path.

- [ ] **Step 4: Update main.rs update command**

Update `cmd_update()` in main.rs — the `--set-repo` flag now sets `workspace.repo` instead of per-component repos. The component list is still `["tarmak", "tarmak-cli"]` but they share one repo.

- [ ] **Step 5: Update tests**

Rewrite `crates/tarmak-cli/tests/update_test.rs` for the new single-repo model. Test JSON should use the new schema with `workspace.repo`.

- [ ] **Step 6: Run tests**

```bash
cargo test -p tarmak-cli
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add crates/tarmak-cli/
git commit -m "refactor(tarmak-cli): simplify update.rs for monorepo model"
```

---

### Task 8: Merge CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Merge cortx documentation into CLAUDE.md**

Read the existing CLAUDE.md and add a new section for tarmak-cli. The merged structure:

```markdown
# Tarmak

(existing content: Architecture, Commands, Binary, MCP Server, Key patterns, Testing)

## Tarmak CLI (crates/tarmak-cli)

Configure Claude Code dev environment — hooks, MCP servers, plugins.

### CLI Commands

```
tarmak-cli install       Configure Claude Code (hooks + MCP + plugin instructions)
tarmak-cli uninstall     Remove tarmak-cli configuration from Claude Code
tarmak-cli doctor        Check configuration status
tarmak-cli hook          PreToolUse hook handler (stdin JSON → stdout JSON)
tarmak-cli exec -- CMD   Execute CMD and clean its output
tarmak-cli update        Update tarmak and/or tarmak-cli to latest version
```

### CLI Modules

| Module | Responsibility |
|--------|---------------|
| `clean.rs` | Output cleaning pipeline (strip ANSI, dedup blanks, strip progress) |
| `hook.rs` | PreToolUse hook JSON rewrite (anti-recursion + token-cleaner) |
| `config.rs` | Read/write `~/.claude/settings.json` and `.mcp.json` (atomic writes) |
| `install.rs` | Install/uninstall hooks + MCP tarmak config |
| `doctor.rs` | Diagnostic checks (binary, hook, MCP, plugin) |
| `detect.rs` | Auto-detection of workspace root, docker containers, install modes |
| `update.rs` | Update logic: git pull, cargo install |

## Skills Plugin (skills/)

Claude Code plugin with skills, agents, hooks, and commands. Installed via marketplace.
```

Also include the "Key Patterns" section from the cortx CLAUDE.md (atomic writes, anti-recursion, `read_json` behavior).

Update the Architecture section to include `tarmak-cli` and `skills/`.

Update the main.rs plugin marketplace instructions if they reference `tienedev/tarmak-skills` — they should point to the new monorepo path.

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
# Build tarmak-cli
cli:
	$(CARGO) build -p tarmak-cli
```

Update `.PHONY` line to include `cli`.

- [ ] **Step 2: Add tarmak-cli smoke test to CI**

In `.github/workflows/backend.yml`, in the `build` job, after the existing `./target/debug/tarmak --help` line, add:

```yaml
      - name: Verify binaries
        run: |
          ./target/debug/tarmak --help
          ./target/debug/tarmak-cli --help
```

- [ ] **Step 3: Commit**

```bash
git add Makefile .github/workflows/backend.yml
git commit -m "chore: add tarmak-cli to Makefile and CI"
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

Expected: all tests pass (tarmak + tarmak-cli + kbf).

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
grep -r "cortx" crates/tarmak-cli/ --include="*.rs" | grep -v "legacy\|migration\|token-cleaner"
```

Expected: 0 results (only intentional legacy migration references should remain).

- [ ] **Step 6: Verify tarmak-cli binary works**

```bash
cargo run -p tarmak-cli -- --help
```

Expected: shows help with command name `tarmak-cli`.

- [ ] **Step 7: Verify frontend still builds**

```bash
cd frontend && corepack pnpm run build
```

Expected: builds successfully.

- [ ] **Step 8: Verify make cli works**

```bash
make cli
```

Expected: builds tarmak-cli successfully.

- [ ] **Step 9: Commit any remaining fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix: address final verification issues"
```

---

### Task 11: Post-migration cleanup (deferred)

These items are done manually after the migration is verified and merged:

- [ ] **Step 1:** Archive `cortx` and `tarmak-skills` repos on GitHub
- [ ] **Step 2:** Update plugin marketplace URL if users installed from the old `tarmak-skills` repo
- [ ] **Step 3:** Remove the `cortx-project/` parent directory wrapper
- [ ] **Step 4:** Verify `.mcp.json.example` at repo root has no cortx references
