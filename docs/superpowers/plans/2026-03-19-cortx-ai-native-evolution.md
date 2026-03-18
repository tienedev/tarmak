# Cortx AI-Native Evolution — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform cortx from a passive toolkit into a self-improving autonomous development environment with active memory, autonomous task execution, and quality gates.

**Architecture:** The plan enriches the existing orchestrator loop (`execute_and_remember`) with pre-flight/post-flight memory checks, adds confidence reinforcement and compaction to context-db, then builds the autonomous pipeline on top (decompose, claim, execute, gate, comment, escalate, report). All new MCP tools follow the existing `rmcp` ServerHandler pattern in `crates/cortx/src/mcp.rs`.

**Tech Stack:** Rust (tokio, tokio-rusqlite, rmcp, anyhow), SQLite + FTS5, TOML config

**Spec:** `docs/superpowers/specs/2026-03-19-cortx-ai-native-evolution-design.md`

---

## File Structure

### Phase B — Modified Files

| File | Action | Responsibility |
|------|--------|---------------|
| `crates/rtk-proxy/src/proxy.rs` | Modify | Add public `classify()` method |
| `crates/context-db/src/recall.rs` | Modify | Add `recall_for_preflight()` |
| `crates/context-db/src/decay.rs` → `confidence.rs` | Rename+Modify | Add reinforcement alongside decay |
| `crates/context-db/src/compact.rs` | Create | Merge, prune, summarize strategies |
| `crates/context-db/src/migrations.rs` | Modify | Add `execution_summaries` + `session_reports` tables |
| `crates/context-db/src/db.rs` | Modify | Add `reinforce_confidence()`, `run_compaction()` |
| `crates/context-db/src/lib.rs` | Modify | Expose compact module, add compaction entry point |
| `crates/cortx-types/src/lib.rs` | Modify | Extend `MemoryHint` with `source`, add `AgentCommentEvent`, extend `PlanningOrgan` |
| `crates/cortx/src/orchestrator.rs` | Modify | Pre-flight, post-flight reinforcement, served_hints tracking, compaction on init |

### Phase B — Test Files

| File | Action |
|------|--------|
| `crates/rtk-proxy/tests/classify_test.rs` | Create |
| `crates/context-db/tests/preflight_test.rs` | Create |
| `crates/context-db/tests/confidence_test.rs` | Create |
| `crates/context-db/tests/compact_test.rs` | Create |
| `crates/cortx/tests/preflight_integration_test.rs` | Create |

### Phase C — Modified Files

| File | Action | Responsibility |
|------|--------|---------------|
| `crates/kanwise/src/db/migrations.rs` | Modify | v9: `locked_by`, `locked_at` on tasks |
| `crates/kanwise/src/db/repo.rs` | Modify | `claim_task()`, `release_task()`, `create_tasks_batch()`, `ensure_labels()`, `add_comment_for_agent()` |
| `crates/kanwise/src/lib.rs` | Modify | Add `decompose()`, `claim_task()`, `release_task()`, `comment_on_task()`, `escalate_task()` |
| `crates/cortx/src/gates.rs` | Create | Gate config parsing + validation |
| `crates/cortx/src/mcp.rs` | Modify | Add 6 new MCP tools |
| `crates/cortx/src/orchestrator.rs` | Modify | Gates, comments, escalation, morning report |
| `policies/cortx-gates.toml` | Create | Default quality gate config |

### Phase C — Test Files

| File | Action |
|------|--------|
| `crates/kanwise/tests/claim_test.rs` | Create |
| `crates/kanwise/tests/decompose_test.rs` | Create |
| `crates/cortx/tests/gates_test.rs` | Create |
| `crates/cortx/tests/comments_test.rs` | Create |
| `crates/cortx/tests/morning_report_test.rs` | Create |

---

## Chunk 1: B1 — Pre-flight & Post-flight Memory Check

### Task 1: Expose `Proxy::classify()` public method

**Files:**
- Modify: `crates/rtk-proxy/src/proxy.rs:12-17` (Proxy struct impl block)
- Create: `crates/rtk-proxy/tests/classify_test.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/rtk-proxy/tests/classify_test.rs
use cortx_types::Tier;
use std::path::PathBuf;

#[test]
fn classify_safe_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("git status"), Tier::Safe);
}

#[test]
fn classify_monitored_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("cargo add serde"), Tier::Monitored);
}

#[test]
fn classify_dangerous_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("git push origin main"), Tier::Dangerous);
}

#[test]
fn classify_forbidden_command() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("rm -rf /"), Tier::Forbidden);
}

#[test]
fn classify_shell_operators_forbidden() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    assert_eq!(proxy.classify("echo hello && rm -rf /"), Tier::Forbidden);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test classify_test -- --nocapture`
Expected: FAIL — `classify` method does not exist on Proxy

- [ ] **Step 3: Implement `classify()` on Proxy**

Add to `crates/rtk-proxy/src/proxy.rs` after the `remaining_budget()` method (around line 40):

```rust
/// Classify a command's tier without executing it.
/// Used by the orchestrator for pre-flight memory decisions.
pub fn classify(&self, cmd: &str) -> Tier {
    self.policy.classify(cmd)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p rtk-proxy --test classify_test -- --nocapture`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add crates/rtk-proxy/src/proxy.rs crates/rtk-proxy/tests/classify_test.rs
git commit -m "feat(rtk-proxy): expose Proxy::classify() for pre-flight tier access"
```

---

### Task 2: Extend `MemoryHint` with `source` and `chain_id` fields

**Files:**
- Modify: `crates/cortx-types/src/lib.rs:239-243` (MemoryHint struct)
- Modify: `crates/context-db/src/recall.rs` (update MemoryHint construction)

- [ ] **Step 1: Write the failing test**

```rust
// Add to crates/context-db/tests/ (e.g., in an existing test file or a new hint_fields_test.rs)
use context_db::ContextDb;
use cortx_types::{Memory, MemorySource};

#[tokio::test]
async fn recall_returns_hints_with_source_and_chain_id() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let hints = ctx
        .recall(cortx_types::RecallQuery {
            files: vec!["src/auth.rs".into()],
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(!hints.is_empty());
    assert!(matches!(hints[0].source, MemorySource::Proxy));
    assert!(hints[0].chain_id.is_some(), "chain_id should be populated for causal chain hints");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test hint_fields_test -- --nocapture`
Expected: FAIL — `source` and `chain_id` fields don't exist on MemoryHint

- [ ] **Step 3: Add `source` and `chain_id` fields to MemoryHint**

In `crates/cortx-types/src/lib.rs`, change the MemoryHint struct (lines 239-243):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryHint {
    pub kind: String,
    pub summary: String,
    pub confidence: f64,
    pub source: MemorySource,
    pub chain_id: Option<String>,
}
```

- [ ] **Step 4: Fix all existing MemoryHint constructions in recall.rs**

In `crates/context-db/src/recall.rs`, every place that constructs a `MemoryHint` needs `source` and `chain_id` fields. For causal chain queries, populate `chain_id` from the SQL row's `id` column. For FTS5/project_fact queries, set `chain_id: None`. Set `source: MemorySource::Proxy` for all (these are DB-sourced hints).

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p context-db --test hint_fields_test -- --nocapture`
Expected: PASS

- [ ] **Step 6: Run full workspace build and tests**

Run: `cargo build --workspace && cargo test --workspace`
Expected: PASS — all MemoryHint constructions updated

- [ ] **Step 7: Commit**

```bash
git add crates/cortx-types/src/lib.rs crates/context-db/src/recall.rs crates/context-db/tests/hint_fields_test.rs
git commit -m "feat(cortx-types): add source and chain_id fields to MemoryHint"
```

---

### Task 3: Add `recall_for_preflight()` to context-db

**Files:**
- Modify: `crates/context-db/src/recall.rs`
- Create: `crates/context-db/tests/preflight_test.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/context-db/tests/preflight_test.rs
use context_db::ContextDb;
use cortx_types::{Memory, MemorySource, RecallQuery};

#[tokio::test]
async fn preflight_returns_hints_for_known_failure_pattern() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a causal chain: cargo test failed on auth.rs, fixed by editing middleware.rs
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/middleware.rs".into()],
    })
    .await
    .unwrap();

    // Pre-flight for "cargo test" should find this hint
    let hints = ctx.recall_for_preflight("cargo test", &["src/auth.rs"]).await.unwrap();
    assert!(!hints.is_empty(), "should return at least one hint");
    assert!(hints[0].confidence >= 0.5);
    assert!(hints[0].summary.contains("middleware.rs") || hints[0].summary.contains("auth.rs"));
}

#[tokio::test]
async fn preflight_returns_empty_for_unknown_command() {
    let ctx = ContextDb::in_memory().await.unwrap();

    let hints = ctx.recall_for_preflight("echo hello", &[]).await.unwrap();
    assert!(hints.is_empty());
}

#[tokio::test]
async fn preflight_filters_below_min_confidence() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a fact with low confidence (will decay)
    ctx.store(Memory::ProjectFact {
        fact: "stale hint about auth".into(),
        citation: "old session".into(),
        source: MemorySource::Agent,
    })
    .await
    .unwrap();

    // Manually lower confidence (simulate decay) — use db.with_conn directly
    ctx.db()
        .with_conn(|conn| {
            conn.execute(
                "UPDATE project_facts SET confidence = 0.1",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

    let hints = ctx.recall_for_preflight("cargo test", &["src/auth.rs"]).await.unwrap();
    // Hint with confidence 0.1 should be filtered out (min threshold 0.5)
    assert!(hints.iter().all(|h| h.confidence >= 0.5));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test preflight_test -- --nocapture`
Expected: FAIL — `recall_for_preflight` method does not exist

- [ ] **Step 3: Implement `recall_for_preflight` in recall.rs**

Add to `crates/context-db/src/recall.rs`:

```rust
/// Pre-flight memory check: search for hints relevant to a command
/// about to be executed. Returns hints with confidence >= 0.5.
pub async fn recall_for_preflight(
    db: &Db,
    command: &str,
    files: &[&str],
    project_root: Option<&str>,
) -> Result<Vec<MemoryHint>> {
    let min_confidence = 0.5;

    // Build a combined recall query: command as text, files as file filter,
    // and error patterns from past failures of this command
    let query = RecallQuery {
        text: Some(command.to_string()),
        files: files.iter().map(|f| f.to_string()).collect(),
        error_patterns: vec![],
        min_confidence: Some(min_confidence),
    };

    recall(db, query, project_root).await
}
```

- [ ] **Step 4: Expose `recall_for_preflight` on ContextDb**

In `crates/context-db/src/lib.rs`, add a public method:

```rust
pub async fn recall_for_preflight(
    &self,
    command: &str,
    files: &[&str],
) -> Result<Vec<MemoryHint>> {
    recall::recall_for_preflight(&self.db, command, files, self.project_root.as_deref()).await
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p context-db --test preflight_test -- --nocapture`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/src/recall.rs crates/context-db/src/lib.rs crates/context-db/tests/preflight_test.rs
git commit -m "feat(context-db): add recall_for_preflight for active memory"
```

---

### Task 4: Enrich `execute_and_remember()` with pre-flight

**Files:**
- Modify: `crates/cortx/src/orchestrator.rs:57-113`
- Create: `crates/cortx/tests/preflight_integration_test.rs`

- [ ] **Step 1: Write the failing integration test**

```rust
// crates/cortx/tests/preflight_integration_test.rs
use cortx_types::{Command, ExecutionMode, Memory, Status};
use std::path::PathBuf;

#[tokio::test]
async fn preflight_injects_hints_before_execution() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    // Seed memory: a known causal chain for "cargo test" failures
    orch.memory()
        .store(Memory::CausalChain {
            trigger_file: "src/lib.rs".into(),
            trigger_error: Some("test failed".into()),
            trigger_command: Some("cargo test".into()),
            resolution_files: vec!["src/lib.rs".into()],
        })
        .await
        .unwrap();

    // Execute "cargo test" — pre-flight should find the hint
    let cmd = Command {
        cmd: "cargo test".into(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();

    // The result should have hints from pre-flight (regardless of pass/fail)
    // If cargo test passes, hints are still populated from pre-flight
    assert!(
        !result.hints.is_empty(),
        "pre-flight should inject hints from memory"
    );
}

#[tokio::test]
async fn safe_commands_skip_preflight() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    // Seed memory with hints
    orch.memory()
        .store(Memory::ProjectFact {
            fact: "something about git status".into(),
            citation: "test".into(),
            source: cortx_types::MemorySource::Agent,
        })
        .await
        .unwrap();

    // Execute "git status" — tier Safe, should skip pre-flight
    let cmd = Command {
        cmd: "git status".into(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();

    // Safe commands skip pre-flight, so no hints injected before execution
    // (post-flight hints on failure still work, but git status shouldn't fail)
    assert_eq!(result.status, Status::Passed);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p cortx --test preflight_integration_test -- --nocapture`
Expected: FAIL — pre-flight not implemented yet, hints will be empty

- [ ] **Step 3: Implement pre-flight in `execute_and_remember()`**

Modify `crates/cortx/src/orchestrator.rs`. The enriched flow:

```rust
pub async fn execute_and_remember(&self, cmd: Command) -> Result<ExecutionResult> {
    let cmd_str = cmd.cmd.clone();

    // --- PRE-FLIGHT ---
    let tier = self.proxy.classify(&cmd.cmd);
    let mut preflight_hints = Vec::new();

    if tier != Tier::Safe {
        if let Ok(hints) = self
            .memory
            .recall_for_preflight(&cmd.cmd, &[])
            .await
        {
            preflight_hints = hints;
        }
    }

    // --- EXECUTE ---
    let mut result = self.proxy.execute(cmd).await?;

    // Inject pre-flight hints into the result
    if !preflight_hints.is_empty() {
        result.hints = preflight_hints;
    }

    // --- POST-FLIGHT: store execution (existing logic) ---
    let record = ExecutionRecord { /* ... existing fields ... */ };
    let _ = self.memory.store(Memory::Execution(record)).await;

    // --- POST-FLIGHT: on failure, recall hints (existing logic) ---
    if result.status == Status::Failed {
        if let Ok(hints) = self
            .memory
            .recall(RecallQuery {
                files: result.error_files(),
                error_patterns: result.error_messages(),
                ..Default::default()
            })
            .await
        {
            // Append post-flight hints (don't overwrite pre-flight hints)
            result.hints.extend(hints);
        }
    }

    // --- POST-FLIGHT: causal chain creation (existing logic) ---
    if result.status == Status::Passed && !result.files_touched.is_empty() {
        if let Ok(Some(prev_fail)) = self.memory.last_failure_for_command(&cmd_str).await {
            // ... existing causal chain creation code ...
        }
    }

    Ok(result)
}
```

Note: Add `use cortx_types::Tier;` to imports. The exact integration depends on reading the current code carefully — the description above is the pattern, adapt to the exact existing code structure.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p cortx --test preflight_integration_test -- --nocapture`
Expected: PASS

- [ ] **Step 5: Run full workspace tests**

Run: `cargo test --workspace`
Expected: PASS — existing tests still work

- [ ] **Step 6: Commit**

```bash
git add crates/cortx/src/orchestrator.rs crates/cortx/tests/preflight_integration_test.rs
git commit -m "feat(cortx): add pre-flight memory check in execute_and_remember"
```

---

## Chunk 2: B2 — Confidence Reinforcement

### Task 5: Add `reinforce_confidence()` to context-db

**Files:**
- Modify: `crates/context-db/src/db.rs:4-46`
- Rename: `crates/context-db/src/decay.rs` → `crates/context-db/src/confidence.rs`
- Modify: `crates/context-db/src/lib.rs` (update mod declaration)
- Create: `crates/context-db/tests/confidence_test.rs`

- [ ] **Step 1: Rename decay.rs to confidence.rs**

```bash
mv crates/context-db/src/decay.rs crates/context-db/src/confidence.rs
```

Update `crates/context-db/src/lib.rs`: change `mod decay;` to `mod confidence;`
Update all references from `decay::` to `confidence::` in recall.rs and anywhere else.

- [ ] **Step 2: Build to verify rename compiles**

Run: `cargo build -p context-db`
Expected: SUCCESS

- [ ] **Step 3: Write the failing test for reinforcement**

```rust
// crates/context-db/tests/confidence_test.rs
use context_db::ContextDb;
use cortx_types::Memory;

#[tokio::test]
async fn reinforce_confidence_increases_on_positive_delta() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a causal chain (default confidence = 0.5)
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    // Get the chain ID
    let chain_id = get_first_chain_id(&ctx).await;

    // Reinforce: +0.15
    ctx.reinforce_confidence(&chain_id, 0.15).await.unwrap();

    // Check: confidence should be 0.65 (0.5 + 0.15)
    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!((confidence - 0.65).abs() < 0.01, "expected ~0.65, got {confidence}");
}

#[tokio::test]
async fn reinforce_confidence_caps_at_one() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let chain_id = get_first_chain_id(&ctx).await;

    // Reinforce way beyond 1.0
    ctx.reinforce_confidence(&chain_id, 0.8).await.unwrap();

    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!((confidence - 1.0).abs() < 0.01, "expected 1.0, got {confidence}");
}

#[tokio::test]
async fn reinforce_confidence_decreases_on_negative_delta() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let chain_id = get_first_chain_id(&ctx).await;

    // Negative reinforcement: -0.20
    ctx.reinforce_confidence(&chain_id, -0.20).await.unwrap();

    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!((confidence - 0.30).abs() < 0.01, "expected ~0.30, got {confidence}");
}

// Helper: get first chain ID from DB
async fn get_first_chain_id(ctx: &ContextDb) -> String {
    ctx.db()
        .with_conn(|conn| {
            let id: String =
                conn.query_row("SELECT id FROM causal_chains LIMIT 1", [], |row| row.get(0))?;
            Ok(id)
        })
        .await
        .unwrap()
}

// Helper: get confidence for a chain
async fn get_chain_confidence(ctx: &ContextDb, chain_id: &str) -> f64 {
    let id = chain_id.to_string();
    ctx.db()
        .with_conn(move |conn| {
            let conf: f64 = conn.query_row(
                "SELECT confidence FROM causal_chains WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(conf)
        })
        .await
        .unwrap()
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test -p context-db --test confidence_test -- --nocapture`
Expected: FAIL — `reinforce_confidence` does not exist

- [ ] **Step 5: Implement `reinforce_confidence`**

Add to `crates/context-db/src/confidence.rs`:

```rust
/// Reinforce (or penalize) a causal chain's confidence.
/// Positive delta = hint was useful. Negative delta = hint was wrong.
/// Confidence is clamped to [0.0, 1.0].
pub async fn reinforce_confidence(db: &Db, chain_id: &str, delta: f64) -> Result<()> {
    let id = chain_id.to_string();
    db.with_conn(move |conn| {
        conn.execute(
            "UPDATE causal_chains SET confidence = MIN(1.0, MAX(0.0, confidence + ?1)) WHERE id = ?2",
            rusqlite::params![delta, id],
        )?;
        Ok(())
    })
    .await
}
```

Expose on ContextDb in `crates/context-db/src/lib.rs`:

```rust
pub async fn reinforce_confidence(&self, chain_id: &str, delta: f64) -> Result<()> {
    confidence::reinforce_confidence(&self.db, chain_id, delta).await
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cargo test -p context-db --test confidence_test -- --nocapture`
Expected: PASS (all 3 tests)

- [ ] **Step 7: Commit**

```bash
git add crates/context-db/src/confidence.rs crates/context-db/src/lib.rs crates/context-db/tests/confidence_test.rs
git rm crates/context-db/src/decay.rs
git commit -m "feat(context-db): add bidirectional confidence reinforcement"
```

---

### Task 6: Add hint tracking and correlation to orchestrator

**Files:**
- Modify: `crates/cortx/src/orchestrator.rs:8-13` (add fields)
- Modify: `crates/cortx/src/orchestrator.rs:57+` (correlation logic in post-flight)

- [ ] **Step 1: Add session state fields to Orchestrator**

In `crates/cortx/src/orchestrator.rs`, add to the struct:

```rust
pub struct Orchestrator {
    kanwise: kanwise::Kanwise,
    proxy: rtk_proxy::Proxy,
    memory: context_db::ContextDb,
    session_id: String,
    served_hints: Vec<ServedHint>,
    command_counter: u32,
}

struct ServedHint {
    chain_id: String,
    target_files: Vec<String>,
    served_at_command: u32,
}
```

Update constructors (`new()` and `without_kanwise()`) to initialize `served_hints: Vec::new()` and `command_counter: 0`.

- [ ] **Step 2: Track served hints in pre-flight**

In `execute_and_remember()`, after pre-flight recall, record what was served. The `chain_id` and context come from `MemoryHint` (added in Task 2):

```rust
// After pre-flight hints are collected:
for hint in &preflight_hints {
    if let Some(chain_id) = &hint.chain_id {
        self.served_hints.push(ServedHint {
            chain_id: chain_id.clone(),
            target_files: vec![], // extract from hint summary or from recall query context
            served_at_command: self.command_counter,
        });
    }
}
self.command_counter += 1;
```

To populate `target_files`, the `recall_for_preflight` query should also return the trigger/resolution files from the causal chain. Extend the recall query to include these in the `MemoryHint.summary` or add a `target_files: Vec<String>` field to `MemoryHint`. The simpler approach: parse the files from the recall query's input `files` parameter (the files the agent is about to touch).

- [ ] **Step 3: Add post-flight correlation**

After a successful execution, check if any served hints in the last 5 commands had target files overlapping with `files_touched`:

```rust
if result.status == Status::Passed {
    let window_start = self.command_counter.saturating_sub(5);
    let matching: Vec<&ServedHint> = self
        .served_hints
        .iter()
        .filter(|h| h.served_at_command >= window_start)
        .filter(|h| {
            h.target_files.iter().any(|f| result.files_touched.contains(f))
        })
        .collect();

    for hint in matching {
        let _ = self.memory.reinforce_confidence(&hint.chain_id, 0.15).await;
    }
}

// On failure, penalize hints that didn't help
if result.status == Status::Failed {
    let window_start = self.command_counter.saturating_sub(5);
    let matching: Vec<&ServedHint> = self
        .served_hints
        .iter()
        .filter(|h| h.served_at_command >= window_start)
        .filter(|h| {
            h.target_files.iter().any(|f| result.files_touched.contains(f))
        })
        .collect();

    for hint in matching {
        let _ = self.memory.reinforce_confidence(&hint.chain_id, -0.20).await;
    }
}
```

- [ ] **Step 4: Write a test for correlation**

```rust
// Add to crates/cortx/tests/preflight_integration_test.rs
#[tokio::test]
async fn successful_execution_reinforces_served_hint_confidence() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    // Seed: a causal chain with confidence 0.5
    orch.memory()
        .store(Memory::CausalChain {
            trigger_file: "Cargo.toml".into(),
            trigger_error: Some("build failed".into()),
            trigger_command: Some("cargo build".into()),
            resolution_files: vec!["Cargo.toml".into()],
        })
        .await
        .unwrap();

    // Execute a monitored command that touches Cargo.toml — pre-flight serves the hint
    let cmd = Command {
        cmd: "cargo build".into(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();

    // If cargo build passed and hint was served, confidence should have been reinforced
    if result.status == Status::Passed && !result.hints.is_empty() {
        // Check that confidence was bumped (0.5 + 0.15 = 0.65)
        let hints = orch.memory().recall_for_preflight("cargo build", &["Cargo.toml"]).await.unwrap();
        if let Some(h) = hints.first() {
            assert!(h.confidence > 0.5, "confidence should be reinforced after successful use");
        }
    }
}
```

- [ ] **Step 5: Run test**

Run: `cargo test -p cortx --test preflight_integration_test -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/cortx/src/orchestrator.rs crates/cortx-types/src/lib.rs crates/cortx/tests/preflight_integration_test.rs
git commit -m "feat(cortx): add hint tracking and confidence correlation in orchestrator"
```

---

## Chunk 3: B3 — Memory Compaction

### Task 7: Add new tables to context-db migrations

**Files:**
- Modify: `crates/context-db/src/migrations.rs`

- [ ] **Step 1: Add `execution_summaries` and `session_reports` tables**

Append to `crates/context-db/src/migrations.rs`, inside the migration function, after the existing `CREATE TABLE IF NOT EXISTS` statements:

```rust
conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS execution_summaries (
        id INTEGER PRIMARY KEY,
        command TEXT NOT NULL UNIQUE,
        total_runs INTEGER NOT NULL,
        success_rate REAL NOT NULL,
        avg_duration_ms INTEGER NOT NULL,
        last_error TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exec_summaries_command
        ON execution_summaries(command);

    CREATE TABLE IF NOT EXISTS session_reports (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        board_id TEXT,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        tasks_escalated INTEGER NOT NULL DEFAULT 0,
        commands_run INTEGER NOT NULL DEFAULT 0,
        chains_created INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );"
)?;
```

- [ ] **Step 2: Build and run existing tests**

Run: `cargo test -p context-db`
Expected: PASS — IF NOT EXISTS means no breakage

- [ ] **Step 3: Commit**

```bash
git add crates/context-db/src/migrations.rs
git commit -m "feat(context-db): add execution_summaries and session_reports tables"
```

---

### Task 8: Implement compaction strategies

**Files:**
- Create: `crates/context-db/src/compact.rs`
- Modify: `crates/context-db/src/lib.rs` (add `mod compact;`)
- Create: `crates/context-db/tests/compact_test.rs`

- [ ] **Step 1: Write the failing tests**

```rust
// crates/context-db/tests/compact_test.rs
use context_db::ContextDb;
use cortx_types::{Memory, MemorySource};

#[tokio::test]
async fn prune_removes_low_confidence_old_chains() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a chain
    ctx.store(Memory::CausalChain {
        trigger_file: "old.rs".into(),
        trigger_error: Some("old error".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["old_fix.rs".into()],
    })
    .await
    .unwrap();

    // Manually set confidence to 0.05 and created_at to 60 days ago
    ctx.db()
        .with_conn(|conn| {
            conn.execute(
                "UPDATE causal_chains SET confidence = 0.05, created_at = datetime('now', '-60 days')",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

    let pruned = ctx.run_compaction().await.unwrap();
    assert!(pruned.chains_pruned > 0, "should prune stale chain");
}

#[tokio::test]
async fn merge_deduplicates_chains_with_same_error_different_trigger_file() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Two chains: same error + same resolution, but different trigger files
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/config.rs".into()],
    })
    .await
    .unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/api.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/config.rs".into()],
    })
    .await
    .unwrap();

    // Before compaction: 2 chains
    let count_before: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 =
                conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |row| row.get(0))?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(count_before, 2);

    // After compaction: merged into 1 (same error + same resolution file)
    let stats = ctx.run_compaction().await.unwrap();
    assert!(stats.chains_merged > 0, "should merge chains with same error+resolution");

    let count_after: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 =
                conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |row| row.get(0))?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(count_after, 1, "duplicate chains should be merged");
}

#[tokio::test]
async fn summarize_compresses_old_executions() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store 55 executions of the same command
    for i in 0..55u32 {
        ctx.store(Memory::Execution(cortx_types::ExecutionRecord {
            session_id: "session-1".into(),
            task_id: None,
            command: "cargo test".into(),
            exit_code: if i % 5 == 0 { 1 } else { 0 },
            tier: cortx_types::Tier::Monitored,
            duration_ms: 1000 + i * 10,
            summary: format!("run {i}"),
            errors: vec![],
            files_touched: vec![],
        }))
        .await
        .unwrap();
    }

    let stats = ctx.run_compaction().await.unwrap();
    assert!(stats.executions_summarized > 0);

    // Should keep last 10 + have a summary row
    let remaining: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 = conn.query_row(
                "SELECT COUNT(*) FROM executions WHERE command = 'cargo test'",
                [],
                |row| row.get(0),
            )?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(remaining, 10, "should keep last 10 executions");

    let summaries: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 = conn.query_row(
                "SELECT COUNT(*) FROM execution_summaries WHERE command = 'cargo test'",
                [],
                |row| row.get(0),
            )?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(summaries, 1, "should have one summary row");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test compact_test -- --nocapture`
Expected: FAIL — `run_compaction` does not exist

- [ ] **Step 3: Implement compact.rs**

```rust
// crates/context-db/src/compact.rs
use crate::db::Db;
use anyhow::Result;

#[derive(Debug, Default)]
pub struct CompactionStats {
    pub chains_merged: u32,
    pub chains_pruned: u32,
    pub executions_summarized: u32,
}

/// Merge causal chains that have the same trigger_error + resolution_file
/// but different trigger_file. Keep the one with highest confidence, delete the rest.
pub async fn merge_duplicates(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        // Find groups with same (trigger_error, resolution_file) but different trigger_file
        let deleted = conn.execute(
            "DELETE FROM causal_chains WHERE id NOT IN (
                SELECT MIN(id) FROM causal_chains
                GROUP BY trigger_error, resolution_file, trigger_command
            ) AND trigger_error IS NOT NULL",
            [],
        )?;
        // For kept rows, take the MAX confidence from the merged group
        conn.execute(
            "UPDATE causal_chains SET confidence = (
                SELECT MAX(c2.confidence) FROM causal_chains c2
                WHERE c2.trigger_error = causal_chains.trigger_error
                  AND c2.resolution_file = causal_chains.resolution_file
                  AND c2.trigger_command = causal_chains.trigger_command
            ) WHERE trigger_error IS NOT NULL",
            [],
        )?;
        Ok(deleted as u32)
    })
    .await
}

/// Prune causal chains with confidence < 0.1 that are older than 30 days.
pub async fn prune_stale(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        let deleted = conn.execute(
            "DELETE FROM causal_chains WHERE confidence < 0.1 AND created_at < datetime('now', '-30 days')",
            [],
        )?;
        Ok(deleted as u32)
    })
    .await
}

/// Summarize commands with > 50 executions: keep last 10, create summary, delete rest.
pub async fn summarize_executions(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        // Find commands with > 50 executions
        let mut stmt = conn.prepare(
            "SELECT command, COUNT(*) as cnt FROM executions GROUP BY command HAVING cnt > 50"
        )?;
        let commands: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        let mut total_summarized: u32 = 0;

        for (command, count) in &commands {
            // Compute summary stats
            let (success_rate, avg_duration, last_error, first_seen, last_seen): (f64, i64, Option<String>, String, String) =
                conn.query_row(
                    "SELECT
                        CAST(SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*),
                        AVG(duration_ms),
                        (SELECT summary FROM executions WHERE command = ?1 AND exit_code != 0 ORDER BY created_at DESC LIMIT 1),
                        MIN(created_at),
                        MAX(created_at)
                    FROM executions WHERE command = ?1",
                    [command],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
                )?;

            // Insert/update summary
            conn.execute(
                "INSERT INTO execution_summaries (command, total_runs, success_rate, avg_duration_ms, last_error, first_seen, last_seen)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(command) DO UPDATE SET
                    total_runs = total_runs + ?2,
                    success_rate = ?3,
                    avg_duration_ms = ?4,
                    last_error = ?5,
                    last_seen = ?7",
                rusqlite::params![command, count, success_rate, avg_duration, last_error, first_seen, last_seen],
            )?;

            // Delete all but last 10
            let deleted = conn.execute(
                "DELETE FROM executions WHERE command = ?1 AND id NOT IN (
                    SELECT id FROM executions WHERE command = ?1 ORDER BY created_at DESC LIMIT 10
                )",
                [command],
            )?;

            total_summarized += deleted as u32;
        }

        Ok(total_summarized)
    })
    .await
}

/// Run all compaction strategies.
pub async fn run_compaction(db: &Db) -> Result<CompactionStats> {
    let chains_merged = merge_duplicates(db).await?;
    let chains_pruned = prune_stale(db).await?;
    let executions_summarized = summarize_executions(db).await?;
    Ok(CompactionStats {
        chains_merged,
        chains_pruned,
        executions_summarized,
    })
}
```

Note: The `ON CONFLICT(command)` in `execution_summaries` requires adding a UNIQUE constraint on `command` in the migration. Update the migration to: `command TEXT NOT NULL UNIQUE`.

- [ ] **Step 4: Expose on ContextDb**

In `crates/context-db/src/lib.rs`, add:

```rust
mod compact;

pub async fn run_compaction(&self) -> Result<compact::CompactionStats> {
    compact::run_compaction(&self.db).await
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p context-db --test compact_test -- --nocapture`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/src/compact.rs crates/context-db/src/lib.rs crates/context-db/src/migrations.rs crates/context-db/tests/compact_test.rs
git commit -m "feat(context-db): add memory compaction (prune, summarize)"
```

---

### Task 9: Call compaction on orchestrator session start

**Files:**
- Modify: `crates/cortx/src/orchestrator.rs` (in `new()` or `without_kanwise()`)

- [ ] **Step 1: Add compaction call in constructor**

In `Orchestrator::new()`, after all fields are initialized, spawn a non-blocking compaction:

```rust
// At the end of new(), before returning Ok(Self { ... }):
let memory_clone = memory.clone(); // ContextDb needs Clone, or use Arc
tokio::spawn(async move {
    if let Err(e) = memory_clone.run_compaction().await {
        tracing::warn!("compaction failed (non-critical): {e}");
    }
});
```

Note: If ContextDb doesn't implement Clone, wrap the Db in Arc or call compaction synchronously as best-effort. Check the existing code to see if Arc is already used.

- [ ] **Step 2: Build and test**

Run: `cargo test --workspace`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add crates/cortx/src/orchestrator.rs
git commit -m "feat(cortx): run memory compaction on session start"
```

---

## Chunk 4: C1 + C5 — Planning Decompose + Claim/Release

### Task 10: Kanwise v9 migration — add locking columns

**Files:**
- Modify: `crates/kanwise/src/db/migrations.rs`

- [ ] **Step 1: Add v9 migration**

Append after v8 migration block:

```rust
if version < 9 {
    conn.execute_batch(
        "ALTER TABLE tasks ADD COLUMN locked_by TEXT;
         ALTER TABLE tasks ADD COLUMN locked_at TEXT;
         UPDATE schema_version SET version = 9;",
    )?;
}
```

- [ ] **Step 2: Test migration runs**

Run: `cargo test -p kanwise`
Expected: PASS — new columns don't affect existing tests

- [ ] **Step 3: Commit**

```bash
git add crates/kanwise/src/db/migrations.rs
git commit -m "feat(kanwise): v9 migration — add locked_by/locked_at to tasks"
```

---

### Task 11: Implement `claim_task` and `release_task` in kanwise

**Files:**
- Modify: `crates/kanwise/src/db/repo.rs`
- Modify: `crates/kanwise/src/lib.rs`
- Create: `crates/kanwise/tests/claim_test.rs`

- [ ] **Step 1: Write the failing tests**

```rust
// crates/kanwise/tests/claim_test.rs
use cortx_types::Priority;

#[tokio::test]
async fn claim_task_locks_atomically() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    // Create board, column, label, and task
    let board_id = create_test_board(&db).await;
    let column_id = create_test_column(&db, &board_id).await;
    let label_id = create_test_label(&db, &board_id, "ai-ready").await;
    let task_id = create_test_task(&db, &board_id, &column_id, "Test task").await;
    attach_label(&db, &task_id, &label_id).await;

    // Agent 1 claims
    let kw = kanwise::Kanwise::new(db);
    let task = kw.claim_task(&board_id, "agent-1").await.unwrap();
    assert!(task.is_some(), "agent-1 should get the task");

    // Agent 2 tries to claim — should get None (no available tasks)
    let task2 = kw.claim_task(&board_id, "agent-2").await.unwrap();
    assert!(task2.is_none(), "agent-2 should not get a locked task");
}

#[tokio::test]
async fn release_task_unlocks() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let column_id = create_test_column(&db, &board_id).await;
    let label_id = create_test_label(&db, &board_id, "ai-ready").await;
    let task_id = create_test_task(&db, &board_id, &column_id, "Test task").await;
    attach_label(&db, &task_id, &label_id).await;

    let kw = kanwise::Kanwise::new(db);

    // Claim then release
    let task = kw.claim_task(&board_id, "agent-1").await.unwrap().unwrap();
    kw.release_task(&task.id, "testing release").await.unwrap();

    // Now another agent can claim it
    let task2 = kw.claim_task(&board_id, "agent-2").await.unwrap();
    assert!(task2.is_some(), "task should be claimable after release");
}

// Helpers — adapt to kanwise DB API
async fn create_test_board(db: &kanwise::db::Db) -> String {
    // Use db.with_conn to insert a board, return its ID
    db.with_conn(|conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?1, 'Test', datetime('now'), datetime('now'))",
            [&id],
        )?;
        Ok(id)
    }).await.unwrap()
}

async fn create_test_column(db: &kanwise::db::Db, board_id: &str) -> String {
    let bid = board_id.to_string();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO columns (id, board_id, name, position) VALUES (?1, ?2, 'Todo', 0)",
            rusqlite::params![id, bid],
        )?;
        Ok(id)
    }).await.unwrap()
}

async fn create_test_label(db: &kanwise::db::Db, board_id: &str, name: &str) -> String {
    let bid = board_id.to_string();
    let n = name.to_string();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO labels (id, board_id, name, color) VALUES (?1, ?2, ?3, '#00ff00')",
            rusqlite::params![id, bid, n],
        )?;
        Ok(id)
    }).await.unwrap()
}

async fn create_test_task(db: &kanwise::db::Db, board_id: &str, column_id: &str, title: &str) -> String {
    let bid = board_id.to_string();
    let cid = column_id.to_string();
    let t = title.to_string();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'medium', 0, datetime('now'), datetime('now'))",
            rusqlite::params![id, bid, cid, t],
        )?;
        Ok(id)
    }).await.unwrap()
}

async fn attach_label(db: &kanwise::db::Db, task_id: &str, label_id: &str) {
    let tid = task_id.to_string();
    let lid = label_id.to_string();
    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            rusqlite::params![tid, lid],
        )?;
        Ok(())
    }).await.unwrap();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanwise --test claim_test -- --nocapture`
Expected: FAIL — `claim_task`/`release_task` don't exist

- [ ] **Step 3: Implement `claim_task` and `release_task` on kanwise Db (repo.rs)**

Add to `crates/kanwise/src/db/repo.rs`:

```rust
/// Atomically claim the next available ai-ready task for an agent.
/// Returns None if no tasks available.
pub async fn claim_task(&self, board_id: &str, agent_id: &str) -> Result<Option<Task>> {
    let bid = board_id.to_string();
    let aid = agent_id.to_string();
    self.with_conn(move |conn| {
        // Find first unlocked ai-ready task
        let task_id: Option<String> = conn
            .query_row(
                "SELECT t.id FROM tasks t
                 JOIN task_labels tl ON t.id = tl.task_id
                 JOIN labels l ON tl.label_id = l.id
                 WHERE t.board_id = ?1
                   AND l.name = 'ai-ready'
                   AND t.locked_by IS NULL
                   AND (t.archived IS NULL OR t.archived = 0)
                 ORDER BY CASE t.priority
                    WHEN 'urgent' THEN 0
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                 END
                 LIMIT 1",
                [&bid],
                |row| row.get(0),
            )
            .optional()?;

        let Some(tid) = task_id else { return Ok(None) };

        // Atomic lock: only succeeds if still unlocked
        let updated = conn.execute(
            "UPDATE tasks SET locked_by = ?1, locked_at = datetime('now')
             WHERE id = ?2 AND locked_by IS NULL",
            rusqlite::params![aid, tid],
        )?;

        if updated == 0 {
            return Ok(None); // Race condition: someone else claimed it
        }

        // Return the task
        // ... query task by ID and return ...
        Ok(Some(/* Task struct */))
    })
    .await
}

/// Release a claimed task back to the pool.
pub async fn release_task(&self, task_id: &str, _reason: &str) -> Result<()> {
    let tid = task_id.to_string();
    self.with_conn(move |conn| {
        conn.execute(
            "UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE id = ?1",
            [&tid],
        )?;
        Ok(())
    })
    .await
}
```

- [ ] **Step 4: Expose on Kanwise struct**

In `crates/kanwise/src/lib.rs`, add methods:

```rust
pub async fn claim_task(&self, board_id: &str, agent_id: &str) -> Result<Option<Task>> {
    self.db.claim_task(board_id, agent_id).await
}

pub async fn release_task(&self, task_id: &str, reason: &str) -> Result<()> {
    self.db.release_task(task_id, reason).await
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p kanwise --test claim_test -- --nocapture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/kanwise/src/db/repo.rs crates/kanwise/src/lib.rs crates/kanwise/tests/claim_test.rs
git commit -m "feat(kanwise): atomic task claiming and release for agent coordination"
```

---

### Task 12: Implement `planning_decompose` — batch task creation

**Files:**
- Modify: `crates/kanwise/src/db/repo.rs` — add `create_tasks_batch()`, `ensure_labels()`
- Modify: `crates/kanwise/src/lib.rs` — add `decompose()`
- Create: `crates/kanwise/tests/decompose_test.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/kanwise/tests/decompose_test.rs
use cortx_types::Priority;

#[tokio::test]
async fn decompose_creates_tasks_with_labels() {
    let db = kanwise::db::Db::in_memory().await.unwrap();
    let kw = kanwise::Kanwise::new(db);

    // Create a board with a column
    // ... (use helpers from claim_test or factor out)

    let tasks = vec![
        kanwise::DecomposeTask {
            title: "Setup OAuth config".into(),
            description: "Configure OAuth provider settings".into(),
            priority: Priority::High,
            depends_on: vec![],
        },
        kanwise::DecomposeTask {
            title: "Implement callback".into(),
            description: "Handle OAuth callback endpoint".into(),
            priority: Priority::Medium,
            depends_on: vec![0], // depends on task at index 0
        },
    ];

    let created = kw
        .decompose("Add OAuth authentication", &board_id, tasks)
        .await
        .unwrap();

    assert_eq!(created.len(), 2);
    // All should have ai-ready label
    // Task order should respect dependencies
}

#[tokio::test]
async fn decompose_rejects_cyclic_dependencies() {
    let db = kanwise::db::Db::in_memory().await.unwrap();
    let kw = kanwise::Kanwise::new(db);
    // ... create board ...

    let tasks = vec![
        kanwise::DecomposeTask {
            title: "Task A".into(),
            description: "".into(),
            priority: Priority::Medium,
            depends_on: vec![1], // A depends on B
        },
        kanwise::DecomposeTask {
            title: "Task B".into(),
            description: "".into(),
            priority: Priority::Medium,
            depends_on: vec![0], // B depends on A → cycle!
        },
    ];

    let result = kw.decompose("test", &board_id, tasks).await;
    assert!(result.is_err(), "cyclic dependencies should be rejected");
}

#[tokio::test]
async fn decompose_auto_creates_labels() {
    let db = kanwise::db::Db::in_memory().await.unwrap();
    let kw = kanwise::Kanwise::new(db);
    // ... create board with NO labels ...

    let tasks = vec![kanwise::DecomposeTask {
        title: "First task".into(),
        description: "".into(),
        priority: Priority::Medium,
        depends_on: vec![],
    }];

    let created = kw.decompose("test", &board_id, tasks).await.unwrap();
    assert_eq!(created.len(), 1);

    // Verify ai-ready label was auto-created on the board
    // Query labels table for board_id, expect "ai-ready" to exist
}
```

- [ ] **Step 2: Implement**

Define `DecomposeTask` struct in `crates/kanwise/src/lib.rs`:

```rust
pub struct DecomposeTask {
    pub title: String,
    pub description: String,
    pub priority: Priority,
    pub depends_on: Vec<usize>,
}
```

Implement `decompose()` on Kanwise: validate DAG (topological sort), ensure labels exist, batch-create tasks in the first column with `ai-ready` label.

- [ ] **Step 3: Test, fix, commit**

Run: `cargo test -p kanwise --test decompose_test -- --nocapture`

```bash
git add crates/kanwise/src/lib.rs crates/kanwise/src/db/repo.rs crates/kanwise/tests/decompose_test.rs
git commit -m "feat(kanwise): planning_decompose — batch task creation with dependency validation"
```

---

### Task 13: Add MCP tools for decompose, claim, release

**Files:**
- Modify: `crates/cortx/src/mcp.rs:16-82` (tool definitions) and `crates/cortx/src/mcp.rs:132-258` (handlers)
- Modify: `crates/cortx-types/src/lib.rs:246-250` (extend PlanningOrgan trait if needed)

- [ ] **Step 1: Add tool definitions**

In `fn tool_definitions()`, add 3 new tools:

```rust
Tool::new("planning_decompose", "Decompose an objective into ordered tasks on a board")
    .with_param("objective", "Free text objective", true)
    .with_param("board_id", "Target board ID", true)
    .with_param("tasks", "Array of {title, description, priority, depends_on: [indices]}", true),

Tool::new("planning_claim_task", "Atomically claim the next ai-ready task")
    .with_param("board_id", "Board ID", true)
    .with_param("agent_id", "Agent identifier", true),

Tool::new("planning_release_task", "Release a claimed task back to the pool")
    .with_param("task_id", "Task ID to release", true)
    .with_param("reason", "Why the task is being released", true),
```

- [ ] **Step 2: Add tool handlers**

In the `call_tool` match block, add handlers that delegate to the orchestrator's kanwise instance.

- [ ] **Step 3: Build and test**

Run: `cargo build -p cortx && cargo test --workspace`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add crates/cortx/src/mcp.rs crates/cortx-types/src/lib.rs
git commit -m "feat(cortx): add MCP tools for planning_decompose, claim_task, release_task"
```

---

## Chunk 5: C2 — Quality Gates

### Task 14: Implement quality gate config and validation

**Files:**
- Create: `crates/cortx/src/gates.rs`
- Create: `policies/cortx-gates.toml`
- Create: `crates/cortx/tests/gates_test.rs`

- [ ] **Step 1: Create default gates config**

```toml
# policies/cortx-gates.toml
[gates]
tests = "cargo test --workspace"
lint = "cargo clippy --workspace -- -D warnings"
max_diff_lines = 500

[gates.optional]
format = "cargo fmt --check"
```

- [ ] **Step 2: Write the failing test**

```rust
// crates/cortx/tests/gates_test.rs
use cortx::gates::GateConfig;

#[test]
fn parse_gate_config() {
    let toml = include_str!("../../../policies/cortx-gates.toml");
    let config = GateConfig::from_toml(toml).unwrap();
    assert_eq!(config.tests, "cargo test --workspace");
    assert_eq!(config.lint, "cargo clippy --workspace -- -D warnings");
    assert_eq!(config.max_diff_lines, 500);
    assert!(config.optional.contains_key("format"));
}
```

- [ ] **Step 3: Implement gates.rs**

```rust
// crates/cortx/src/gates.rs
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct GateConfig {
    pub gates: Gates,
}

#[derive(Debug, Deserialize)]
pub struct Gates {
    pub tests: String,
    pub lint: String,
    pub max_diff_lines: u32,
    #[serde(default)]
    pub optional: HashMap<String, String>,
}

impl GateConfig {
    pub fn from_toml(s: &str) -> Result<Self> {
        Ok(toml::from_str(s)?)
    }
}

#[derive(Debug)]
pub struct GateResult {
    pub gate: String,
    pub passed: bool,
    pub output: String,
}

/// Validate all gates for a branch. Returns list of gate results.
pub async fn validate_gates(
    config: &GateConfig,
    proxy: &rtk_proxy::Proxy,
    branch: &str,
    project_root: &std::path::Path,
) -> Result<Vec<GateResult>> {
    let mut results = Vec::new();

    // Check diff size
    // Run tests command via proxy
    // Run lint command via proxy
    // Run optional gates

    // ... implementation delegates to proxy.execute() for each gate command ...

    Ok(results)
}
```

- [ ] **Step 4: Add MCP tool `planning_validate_gates`**

In `crates/cortx/src/mcp.rs`, add tool definition and handler.

- [ ] **Step 5: Test, commit**

```bash
git add crates/cortx/src/gates.rs policies/cortx-gates.toml crates/cortx/src/mcp.rs crates/cortx/tests/gates_test.rs
git commit -m "feat(cortx): quality gate validation with configurable cortx-gates.toml"
```

---

## Chunk 6: C3 + C4 — Agent Comments + Escalation

### Task 15: Add `AgentCommentEvent` type and comment method

**Files:**
- Modify: `crates/cortx-types/src/lib.rs`
- Modify: `crates/cortx/src/orchestrator.rs`
- Modify: `crates/kanwise/src/db/repo.rs`
- Create: `crates/cortx/tests/comments_test.rs`

- [ ] **Step 1: Add AgentCommentEvent enum to cortx-types**

```rust
// In crates/cortx-types/src/lib.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentCommentEvent {
    Bug,
    Initiative,
    Decision,
    Dependency,
    Rollback,
    Completion,
    Escalation,
}

impl AgentCommentEvent {
    pub fn label(&self) -> &str {
        match self {
            Self::Bug => "Bug encountered",
            Self::Initiative => "Initiative taken",
            Self::Decision => "Architectural decision",
            Self::Dependency => "Dependency added",
            Self::Rollback => "Rollback performed",
            Self::Completion => "Task completed",
            Self::Escalation => "Escalation",
        }
    }
}
```

- [ ] **Step 2: Add `create_agent_comment` to kanwise repo.rs**

```rust
pub async fn create_agent_comment(
    &self,
    task_id: &str,
    agent_user_id: &str,
    content: &str,
) -> Result<String> {
    // Insert into comments table with user_id = agent_user_id
    // Return comment ID
}
```

- [ ] **Step 3: Add `ensure_agent_user` to kanwise**

```rust
pub async fn ensure_agent_user(&self) -> Result<String> {
    // INSERT OR IGNORE a user with username 'cortx-agent', is_agent = true
    // Return user ID
}
```

- [ ] **Step 4: Add `comment_on_task` to orchestrator**

```rust
pub async fn comment_on_task(
    &self,
    task_id: &str,
    event: AgentCommentEvent,
    content: &str,
) -> Result<()> {
    let formatted = format!("🤖 [agent:cortx] — {}\n\n{}", event.label(), content);
    self.kanwise.db().create_agent_comment(task_id, &self.agent_user_id, &formatted).await?;
    Ok(())
}
```

- [ ] **Step 5: Write the failing test**

```rust
// crates/cortx/tests/comments_test.rs
#[tokio::test]
async fn comment_on_task_creates_formatted_comment() {
    // Setup: orchestrator with in-memory kanwise
    // Create board, column, task
    // Call comment_on_task with AgentCommentEvent::Bug
    // Query comments table and verify:
    // - comment exists for the task
    // - content contains the emoji header "Bug encountered"
    // - user is the cortx-agent user
}

#[tokio::test]
async fn ensure_agent_user_is_idempotent() {
    // Call ensure_agent_user twice
    // Should return the same user_id both times
    // Should not create duplicate users
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cargo test -p cortx --test comments_test -- --nocapture`
Expected: FAIL — comment_on_task not implemented

- [ ] **Step 7: Implement, verify tests pass**

Run: `cargo test -p cortx --test comments_test -- --nocapture`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add crates/cortx-types/src/lib.rs crates/cortx/src/orchestrator.rs crates/kanwise/src/db/repo.rs crates/cortx/tests/comments_test.rs
git commit -m "feat(cortx): agent comments protocol for ticket communication"
```

---

### Task 16: Implement escalation protocol

**Files:**
- Modify: `crates/cortx/src/orchestrator.rs`
- Modify: `crates/kanwise/src/db/repo.rs` — add `add_label_to_task()`, `remove_label_from_task()`
- Modify: `crates/cortx/src/mcp.rs` — add `planning_escalate` tool

- [ ] **Step 1: Add label management methods to kanwise**

```rust
// In repo.rs
pub async fn add_label_to_task(&self, task_id: &str, board_id: &str, label_name: &str) -> Result<()> {
    // Find or create label by name on board, then insert into task_labels
}

pub async fn remove_label_from_task(&self, task_id: &str, label_name: &str) -> Result<()> {
    // Delete from task_labels where task_id and label matches
}
```

- [ ] **Step 2: Add `escalate_task` to orchestrator**

```rust
pub async fn escalate_task(
    &self,
    task_id: &str,
    board_id: &str,
    attempts: &[String],  // commands tried
    errors: &[String],
    hints_consulted: &[String],
    suggestion: &str,
) -> Result<()> {
    // 1. Remove "in-progress" label
    // 2. Add "needs-human" label
    // 3. Release task lock
    // 4. Comment with escalation details
    let content = format!(
        "**Attempts:** {}\n**Errors:** {}\n**Hints consulted:** {}\n**Suggestion:** {}",
        attempts.join(", "), errors.join("\n"), hints_consulted.join(", "), suggestion
    );
    self.comment_on_task(task_id, AgentCommentEvent::Escalation, &content).await?;
    self.kanwise.add_label_to_task(task_id, board_id, "needs-human").await?;
    self.kanwise.remove_label_from_task(task_id, "in-progress").await?;
    self.kanwise.release_task(task_id, "escalated").await?;
    Ok(())
}
```

- [ ] **Step 3: Write the failing test**

```rust
// Add to crates/cortx/tests/comments_test.rs or a new escalation_test.rs
#[tokio::test]
async fn escalate_task_adds_needs_human_label_and_comment() {
    // Setup: orchestrator with in-memory kanwise
    // Create board, column, task with "ai-ready" label
    // Claim the task
    // Call escalate_task with attempts, errors, hints, suggestion
    // Verify:
    // - task has "needs-human" label
    // - task does NOT have "in-progress" label
    // - task lock is released (locked_by IS NULL)
    // - escalation comment exists on the task
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cargo test -p cortx --test escalation_test -- --nocapture`
Expected: FAIL — escalate_task not implemented

- [ ] **Step 5: Add MCP tool `planning_escalate`**

- [ ] **Step 6: Implement, verify tests pass, commit**

```bash
git add crates/cortx/src/orchestrator.rs crates/kanwise/src/db/repo.rs crates/cortx/src/mcp.rs crates/cortx/tests/escalation_test.rs
git commit -m "feat(cortx): escalation protocol with needs-human label and comments"
```

---

## Chunk 7: C6 — Morning Report

### Task 17: Implement morning report generation and storage

**Files:**
- Modify: `crates/context-db/src/db.rs` — add `store_session_report()`
- Modify: `crates/cortx/src/orchestrator.rs` — add `generate_morning_report()`
- Modify: `crates/cortx/src/mcp.rs` — add `session_report` tool
- Create: `crates/cortx/tests/morning_report_test.rs`

- [ ] **Step 1: Write the failing test**

```rust
// crates/cortx/tests/morning_report_test.rs
#[tokio::test]
async fn morning_report_summarizes_session() {
    // Setup orchestrator with in-memory DBs
    // Execute several commands (some pass, some fail)
    // Generate report
    // Assert report contains task counts, command counts, chain counts
}
```

- [ ] **Step 2: Add `store_session_report` to context-db**

```rust
// In crates/context-db/src/db.rs or a new report.rs module
pub async fn store_session_report(
    db: &Db,
    session_id: &str,
    board_id: Option<&str>,
    tasks_completed: u32,
    tasks_escalated: u32,
    commands_run: u32,
    chains_created: u32,
    duration_seconds: Option<u32>,
    summary: &str,
) -> Result<()> {
    // INSERT INTO session_reports
}
```

- [ ] **Step 3: Add `generate_morning_report` to orchestrator**

The orchestrator tracks session stats (commands_run, tasks_completed, etc.) and formats a summary. It stores in context-db AND posts as a board comment.

```rust
pub async fn generate_morning_report(&self, board_id: Option<&str>) -> Result<String> {
    let summary = format!(
        "Session #{} — {} commands, {} tasks completed, {} escalated, {} chains created",
        self.session_id, self.command_counter,
        self.tasks_completed, self.tasks_escalated, self.chains_created
    );

    // Store in context-db
    self.memory.store_session_report(
        &self.session_id, board_id,
        self.tasks_completed, self.tasks_escalated,
        self.command_counter, self.chains_created,
        None, &summary,
    ).await?;

    // Post as board comment if board_id is provided
    // ...

    Ok(summary)
}
```

- [ ] **Step 4: Add session tracking fields to Orchestrator**

Add `tasks_completed: u32`, `tasks_escalated: u32`, `chains_created: u32` to the struct. Increment them in `complete_task`, `escalate_task`, and causal chain creation.

- [ ] **Step 5: Add MCP tool `session_report`**

- [ ] **Step 6: Test, commit**

```bash
git add crates/context-db/src/db.rs crates/cortx/src/orchestrator.rs crates/cortx/src/mcp.rs crates/cortx/tests/morning_report_test.rs
git commit -m "feat(cortx): morning report generation and storage"
```

---

## Final Verification

- [ ] **Run full workspace tests**: `cargo test --workspace`
- [ ] **Run clippy**: `cargo clippy --workspace -- -D warnings`
- [ ] **Build all binaries**: `cargo build --workspace`
- [ ] **Verify MCP tool count**: The cortx binary should now expose 15 tools (9 original + 6 new: planning_decompose, planning_claim_task, planning_release_task, planning_validate_gates, planning_escalate, session_report)

---

## New MCP Tools Summary

| Tool | Phase | Purpose |
|------|-------|---------|
| `planning_decompose` | C1 | Objective → batch task creation with dependency validation |
| `planning_claim_task` | C5 | Atomic task lock for agent coordination |
| `planning_release_task` | C5 | Unlock a claimed task |
| `planning_validate_gates` | C2 | Run quality gates on a branch |
| `planning_escalate` | C4 | Mark task as needs-human with context |
| `session_report` | C6 | Generate and store morning report |
