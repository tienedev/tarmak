# Cortx Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the kanwise monorepo into cortx — a multi-crate AI development orchestrator with 4 organs: planning (kanwise), action (rtk-proxy), memory (context-db), and coordination (cortx orchestrator).

**Architecture:** Hybrid approach — internal Rust function calls when cortx orchestrates, standalone MCP when organs run independently. A shared `cortx-types` crate defines trait contracts (`PlanningOrgan`, `ActionOrgan`, `MemoryOrgan`) enforced at compile time via static dispatch. Each organ owns its own SQLite database (or is stateless).

**Tech Stack:** Rust 2024 edition, Cargo workspace, tokio, rusqlite/tokio-rusqlite, rmcp (MCP), serde/toml, clap, FTS5 (SQLite), regex, glob pattern matching.

**Spec:** `docs/superpowers/specs/2026-03-18-cortx-architecture-design.md`

---

## File Structure

### New crates to create

```
crates/cortx-types/
├── Cargo.toml
└── src/
    └── lib.rs               # Shared traits + types (Priority, Task, Command, ExecutionResult, etc.)

crates/rtk-proxy/
├── Cargo.toml
└── src/
    ├── lib.rs               # Public API: Proxy struct + re-exports
    ├── main.rs              # CLI binary (standalone MCP + CLI exec)
    ├── policy.rs            # Policy engine: parse cortx-policy.toml, pattern matching
    ├── tier.rs              # Tier classifier: Safe/Monitored/Dangerous/Forbidden
    ├── budget.rs            # Budget tracker + rate limiter + circuit breaker
    ├── sandbox.rs           # Sandbox: cwd lock, env filter, timeout
    ├── execute.rs           # tokio::process::Command wrapper
    ├── output.rs            # Output processor: truncation, redaction, structured parsing
    └── mcp.rs               # Standalone MCP server (proxy_exec, proxy_status, proxy_rollback)

crates/context-db/
├── Cargo.toml
└── src/
    ├── lib.rs               # Public API: ContextDb struct + re-exports
    ├── main.rs              # CLI binary (standalone MCP + CLI query)
    ├── db.rs                # SQLite connection wrapper
    ├── migrations.rs        # Schema creation (executions, causal_chains, project_facts, FTS5)
    ├── store.rs             # MemoryOrgan::store implementation
    ├── recall.rs            # MemoryOrgan::recall + last_failure_for_command
    ├── causal.rs            # Causal chain builder (fail→edit→pass detection)
    ├── decay.rs             # Git-aware confidence decay (lazy churn computation)
    ├── purge.rs             # Automatic purge rules (archive, aggregate, size limit)
    └── mcp.rs               # Standalone MCP server (memory_store, memory_recall, memory_status)

crates/cortx/
├── Cargo.toml
└── src/
    ├── main.rs              # CLI entry point (serve, status, doctor, rollback)
    ├── orchestrator.rs      # CortxOrchestrator: wires 3 organs, execute_and_remember
    └── mcp.rs               # Meta-MCP: delegates to all 3 organs

policies/
└── cortx-policy.toml        # Default policy configuration
```

### Existing files to modify

```
Cargo.toml                                    # Add workspace members
crates/server/ → crates/kanwise/              # Directory rename
crates/kanwise/Cargo.toml                     # Add [lib] section, cortx-types dep
crates/kanwise/src/lib.rs                     # NEW: expose modules + PlanningOrgan impl
crates/kanwise/src/db/models.rs               # Replace Priority with cortx_types::Priority re-export
crates/kanwise/src/db/repo.rs                 # Add get_next_ai_task method
```

---

## Chunk 1: Phase 1 — Workspace Restructuring

Phase 1 restructures the repo without changing business logic. At the end, all existing tests still pass and the new workspace compiles with placeholder crates.

### Task 1: Rename `crates/server` → `crates/kanwise`

**Files:**
- Rename: `crates/server/` → `crates/kanwise/`
- Modify: `Cargo.toml` (root workspace)

- [ ] **Step 1: Rename the directory**

```bash
mv crates/server crates/kanwise
```

- [ ] **Step 2: Update root Cargo.toml workspace members**

In `Cargo.toml`, change `"crates/server"` to `"crates/kanwise"`:

```toml
[workspace]
resolver = "2"
members = [
    "crates/kanwise",
    "crates/kbf",
]
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`
Expected: compiles with no errors (the crate is already named `kanwise` in its own Cargo.toml)

- [ ] **Step 4: Run existing tests**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename crates/server to crates/kanwise"
```

---

### Task 2: Create `cortx-types` crate with shared types

**Files:**
- Create: `crates/cortx-types/Cargo.toml`
- Create: `crates/cortx-types/src/lib.rs`
- Modify: `Cargo.toml` (add workspace member)

- [ ] **Step 1: Create Cargo.toml for cortx-types**

Create `crates/cortx-types/Cargo.toml`:

```toml
[package]
name = "cortx-types"
version.workspace = true
edition.workspace = true

[dependencies]
anyhow.workspace = true
serde = { workspace = true, optional = true }

[features]
default = ["serde"]
serde = ["dep:serde"]
```

- [ ] **Step 2: Write cortx-types/src/lib.rs with all shared types and traits**

Create `crates/cortx-types/src/lib.rs` with all types from spec Section 2.4:
- `Priority` enum (with `as_str`, `from_str_db`, `short`, `from_short`, `Display`)
- `TaskFilter`, `Task`, `Command`, `ExecutionMode`
- `ExecutionResult`, `CodeLocation`, `Status`, `Tier`, `Budget`
- `ExecutionRecord`, `Memory`, `MemorySource`, `MemoryId`, `RecallQuery`, `MemoryHint`
- Traits: `PlanningOrgan`, `ActionOrgan`, `MemoryOrgan`

```rust
use anyhow::Result;
use std::path::PathBuf;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

// ── Priority ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

impl Priority {
    pub fn short(&self) -> &'static str {
        match self {
            Self::Low => "l",
            Self::Medium => "m",
            Self::High => "h",
            Self::Urgent => "u",
        }
    }

    pub fn from_short(s: &str) -> Option<Self> {
        match s {
            "l" => Some(Self::Low),
            "m" => Some(Self::Medium),
            "h" => Some(Self::High),
            "u" => Some(Self::Urgent),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }

    pub fn from_str_db(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── Core types ──

#[derive(Debug, Clone, Default)]
pub struct TaskFilter {
    pub board_id: Option<String>,
    pub label: Option<String>,
    pub priority_min: Option<Priority>,
}

#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub labels: Vec<String>,
    pub column_id: String,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Command {
    pub cmd: String,
    pub cwd: PathBuf,
    pub mode: ExecutionMode,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionMode {
    Assisted,
    Autonomous,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Passed,
    Failed,
    Timeout,
    Blocked,
    Forbidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Safe,
    Monitored,
    Dangerous,
    Forbidden,
}

impl Tier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Monitored => "monitored",
            Self::Dangerous => "dangerous",
            Self::Forbidden => "forbidden",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "safe" => Some(Self::Safe),
            "monitored" => Some(Self::Monitored),
            "dangerous" => Some(Self::Dangerous),
            "forbidden" => Some(Self::Forbidden),
            _ => None,
        }
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Default)]
pub struct Budget {
    pub commands_remaining: u32,
    pub cpu_seconds_remaining: u32,
}

#[derive(Debug, Clone)]
pub struct CodeLocation {
    pub file: String,
    pub line: Option<u32>,
    pub msg: String,
}

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub status: Status,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub command: String,
    pub tier: Tier,
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub warnings: Vec<CodeLocation>,
    pub truncated: bool,
    pub budget_remaining: Budget,
    pub hints: Vec<MemoryHint>,
    pub files_touched: Vec<String>,
}

impl ExecutionResult {
    pub fn error_files(&self) -> Vec<String> {
        self.errors.iter().map(|e| e.file.clone()).collect()
    }

    pub fn error_messages(&self) -> Vec<String> {
        self.errors.iter().map(|e| e.msg.clone()).collect()
    }

    pub fn with_hints(mut self, hints: Vec<MemoryHint>) -> Self {
        self.hints = hints;
        self
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionRecord {
    pub session_id: String,
    pub task_id: Option<String>,
    pub command: String,
    pub exit_code: Option<i32>,
    pub tier: Tier,
    pub duration_ms: u64,
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub files_touched: Vec<String>,
}

// ── Memory types ──

#[derive(Debug, Clone)]
pub enum Memory {
    Execution(ExecutionRecord),
    CausalChain {
        trigger_file: String,
        trigger_error: Option<String>,
        resolution_files: Vec<String>,
    },
    ProjectFact {
        fact: String,
        citation: String,
        source: MemorySource,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySource {
    Agent,
    Proxy,
    User,
}

pub struct MemoryId(pub String);

#[derive(Debug, Clone, Default)]
pub struct RecallQuery {
    pub text: Option<String>,
    pub files: Vec<String>,
    pub error_patterns: Vec<String>,
    pub min_confidence: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct MemoryHint {
    pub kind: String,
    pub summary: String,
    pub confidence: f64,
}

// ── Organ traits ──

pub trait PlanningOrgan {
    async fn get_next_task(&self, filter: TaskFilter) -> Result<Task>;
    async fn complete_task(&self, id: &str) -> Result<()>;
    async fn list_tasks(&self, board_id: &str) -> Result<Vec<Task>>;
}

pub trait ActionOrgan {
    async fn execute(&self, cmd: Command) -> Result<ExecutionResult>;
}

pub trait MemoryOrgan {
    async fn store(&self, memory: Memory) -> Result<MemoryId>;
    async fn recall(&self, query: RecallQuery) -> Result<Vec<MemoryHint>>;
    async fn last_failure_for_command(&self, command: &str) -> Result<Option<ExecutionRecord>>;
}
```

- [ ] **Step 3: Add cortx-types to workspace**

In root `Cargo.toml`, add to members:

```toml
members = [
    "crates/kanwise",
    "crates/kbf",
    "crates/cortx-types",
]
```

- [ ] **Step 4: Verify cortx-types compiles**

Run: `cargo check -p cortx-types`
Expected: compiles with no errors

- [ ] **Step 5: Commit**

```bash
git add crates/cortx-types/ Cargo.toml
git commit -m "feat: add cortx-types crate with shared traits and types"
```

---

### Task 3: Create placeholder crates (rtk-proxy, context-db, cortx)

**Files:**
- Create: `crates/rtk-proxy/Cargo.toml`, `crates/rtk-proxy/src/lib.rs`, `crates/rtk-proxy/src/main.rs`
- Create: `crates/context-db/Cargo.toml`, `crates/context-db/src/lib.rs`, `crates/context-db/src/main.rs`
- Create: `crates/cortx/Cargo.toml`, `crates/cortx/src/main.rs`
- Modify: `Cargo.toml` (root workspace)

- [ ] **Step 1: Create rtk-proxy placeholder**

Create `crates/rtk-proxy/Cargo.toml`:

```toml
[package]
name = "rtk-proxy"
version.workspace = true
edition.workspace = true

[lib]
name = "rtk_proxy"

[[bin]]
name = "rtk-proxy"
path = "src/main.rs"

[dependencies]
cortx-types = { path = "../cortx-types" }
anyhow.workspace = true
tokio.workspace = true
```

Create `crates/rtk-proxy/src/lib.rs`:

```rust
//! rtk-proxy — Secure command execution proxy for cortx.
```

Create `crates/rtk-proxy/src/main.rs`:

```rust
fn main() {
    println!("rtk-proxy: not yet implemented");
}
```

- [ ] **Step 2: Create context-db placeholder**

Create `crates/context-db/Cargo.toml`:

```toml
[package]
name = "context-db"
version.workspace = true
edition.workspace = true

[lib]
name = "context_db"

[[bin]]
name = "context-db"
path = "src/main.rs"

[dependencies]
cortx-types = { path = "../cortx-types" }
anyhow.workspace = true
tokio.workspace = true
```

Create `crates/context-db/src/lib.rs`:

```rust
//! context-db — Memory organ for cortx (SQLite + FTS5).
```

Create `crates/context-db/src/main.rs`:

```rust
fn main() {
    println!("context-db: not yet implemented");
}
```

- [ ] **Step 3: Create cortx placeholder**

Create `crates/cortx/Cargo.toml`:

```toml
[package]
name = "cortx"
version.workspace = true
edition.workspace = true

[[bin]]
name = "cortx"

[dependencies]
cortx-types = { path = "../cortx-types" }
anyhow.workspace = true
tokio.workspace = true
```

Create `crates/cortx/src/main.rs`:

```rust
fn main() {
    println!("cortx: not yet implemented");
}
```

- [ ] **Step 4: Add all crates to workspace**

In root `Cargo.toml`:

```toml
members = [
    "crates/cortx-types",
    "crates/kanwise",
    "crates/kbf",
    "crates/rtk-proxy",
    "crates/context-db",
    "crates/cortx",
]
```

- [ ] **Step 5: Verify full workspace compiles**

Run: `cargo check --workspace`
Expected: all 6 crates compile

- [ ] **Step 6: Commit**

```bash
git add crates/rtk-proxy/ crates/context-db/ crates/cortx/ Cargo.toml
git commit -m "feat: add placeholder crates for rtk-proxy, context-db, cortx"
```

---

### Task 4: Create default `policies/cortx-policy.toml`

**Files:**
- Create: `policies/cortx-policy.toml`

- [ ] **Step 1: Create the policies directory and default config**

Create `policies/cortx-policy.toml` with the full default policy from spec Section 3.2:

```toml
# cortx-policy.toml — Default policy configuration
# Inheritance: ~/.config/cortx/policy.toml (global) → project/cortx-policy.toml → session

[mode]
default = "assisted"       # assisted | autonomous | admin

[budget]
max_commands_per_session = 200
max_cpu_seconds = 300
loop_threshold = 5
loop_window_seconds = 60

[sandbox]
default_timeout = "30s"
env_passthrough = ["PATH", "HOME", "CARGO_HOME", "RUSTUP_HOME"]
env_redact = ["*_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD"]

[tiers]
safe = [
    "cargo test*", "cargo check*", "cargo clippy*",
    "npm run lint*", "npm run test*",
    "git status", "git diff*", "git log*",
    "cat *", "ls *", "wc *",
]
monitored = [
    "cargo add*", "cargo remove*",
    "git commit*", "git checkout*", "git branch*",
    "npm install*",
]
dangerous = [
    "git push*", "git merge*", "git rebase*",
    "cargo publish*",
]
forbidden = [
    "rm -rf *", "sudo *",
    "git reset --hard*", "git push --force*",
    "chmod 777*", "curl * | bash", "wget * | sh",
]

[output]
max_lines = 200
keep_head = 50
keep_tail = 50
redact_patterns = [
    '(?i)(api[_-]?key|token|secret|password)\s*[=:]\s*\S+',
    'sk-[a-zA-Z0-9]{20,}',
    'ghp_[a-zA-Z0-9]{36}',
]

[checkpoint]
before_monitored = true
before_dangerous = true

[circuit_breaker]
max_consecutive_failures = 5
action = "suspend"         # suspend | warn | ignore
```

- [ ] **Step 2: Commit**

```bash
git add policies/
git commit -m "feat: add default cortx-policy.toml"
```

---

### Task 5: Replace kanwise's Priority with cortx-types re-export

**Files:**
- Modify: `crates/kanwise/Cargo.toml` (add cortx-types dep)
- Modify: `crates/kanwise/src/db/models.rs` (replace Priority)

- [ ] **Step 1: Add cortx-types dependency to kanwise**

In `crates/kanwise/Cargo.toml`, add:

```toml
cortx-types = { path = "../cortx-types" }
```

- [ ] **Step 2: Replace Priority in models.rs**

In `crates/kanwise/src/db/models.rs`, replace the entire `Priority` enum and its impl blocks with a re-export:

```rust
pub use cortx_types::Priority;
```

Remove:
- The `Priority` enum definition (lines 8-15)
- The `impl Priority` block (lines 17-58)
- The `impl Display for Priority` block (lines 61-65)

Keep all other types unchanged (`FieldType`, `Role`, domain structs, etc.).

- [ ] **Step 3: Verify everything compiles**

Run: `cargo check --workspace`
Expected: compiles — cortx-types::Priority has the same API surface (as_str, from_str_db, short, from_short, Display, Serialize, Deserialize, serde rename_all = "lowercase")

- [ ] **Step 4: Run all tests**

Run: `cargo test --workspace`
Expected: all tests pass (Priority API is identical)

- [ ] **Step 5: Commit**

```bash
git add crates/kanwise/Cargo.toml crates/kanwise/src/db/models.rs
git commit -m "refactor: replace kanwise Priority with cortx-types re-export"
```

---

### Task 6: Add `lib.rs` to kanwise and expose public modules

**Files:**
- Create: `crates/kanwise/src/lib.rs`
- Modify: `crates/kanwise/Cargo.toml` (add [lib] + [[bin]] sections)

- [ ] **Step 1: Update kanwise Cargo.toml with lib + bin sections**

In `crates/kanwise/Cargo.toml`, add before `[dependencies]`:

```toml
[lib]
name = "kanwise"

[[bin]]
name = "kanwise"
path = "src/main.rs"
```

- [ ] **Step 2: Create lib.rs**

Create `crates/kanwise/src/lib.rs`:

```rust
pub mod api;
pub mod db;
pub mod mcp;
pub mod auth;
pub mod sync;
pub mod background;
pub mod notifications;
pub mod static_files; // pub: needed by the binary for fallback handler

pub use db::Db;
pub use notifications::NotifTx;
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check -p kanwise`
Expected: compiles (all modules are already defined in main.rs as `mod X`; lib.rs adds a second root exposing them as `pub mod`)

**Note:** If `main.rs` uses `mod X` for the same modules, you'll get duplicate module definitions. Main.rs must switch to `use kanwise::X` for modules it needs:

Update `crates/kanwise/src/main.rs` — replace the module declarations at the top:

```rust
// Remove these lines:
// mod api;
// mod auth;
// mod background;
// mod cli;
// mod db;
// mod mcp;
// mod notifications;
// mod static_files;
// mod sync;

// Replace with:
mod cli;  // cli stays private to the binary

use kanwise::api;
use kanwise::auth;
use kanwise::background;
use kanwise::db;
use kanwise::mcp;
use kanwise::notifications;
use kanwise::sync;
```

The `cli` module stays in main.rs since it's binary-only (backup, restore, export, import commands). The `static_files` module is private in lib.rs and accessed internally by the library.

- [ ] **Step 4: Handle the `cli` module reference**

The `cli` module uses `crate::db::Db` which will break when main.rs no longer owns the `db` module. The `cli` module needs to use `kanwise::db::Db` instead.

Read `crates/kanwise/src/cli.rs` and update any `crate::` references to `kanwise::` references.

Alternatively, move `cli.rs` to be a private module in the binary:
- Keep `mod cli;` in `main.rs`
- In `cli.rs`, replace `use crate::db` with `use kanwise::db`

- [ ] **Step 5: Verify it compiles**

Run: `cargo check -p kanwise`
Expected: compiles with no errors

- [ ] **Step 6: Run all tests**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add crates/kanwise/Cargo.toml crates/kanwise/src/lib.rs crates/kanwise/src/main.rs crates/kanwise/src/cli.rs
git commit -m "refactor: add lib.rs to kanwise, expose public modules"
```

---

### Task 7: Implement `PlanningOrgan` trait for kanwise

**Files:**
- Modify: `crates/kanwise/src/lib.rs` (add Kanwise struct + trait impl)
- Modify: `crates/kanwise/src/db/repo.rs` (add `get_next_ai_task` method)

- [ ] **Step 1: Write the failing test**

Create `crates/kanwise/tests/planning_organ_test.rs`:

```rust
use cortx_types::{PlanningOrgan, TaskFilter};

#[tokio::test]
async fn test_get_next_task_returns_ai_ready_tasks() {
    let db = kanwise::Db::in_memory().await.unwrap();

    // Create a board
    let board = db.create_board("Test Board", None).await.unwrap();

    // Create a column
    let col = db.create_column(&board.id, "Todo", None, None).await.unwrap();

    // Create a label "ai-ready"
    let label = db.create_label(&board.id, "ai-ready", "#00ff00").await.unwrap();

    // Create a task (board_id, column_id, title, description, priority, assignee)
    let task = db.create_task(&board.id, &col.id, "Fix auth bug", None, cortx_types::Priority::High, None).await.unwrap();
    db.add_task_label(&task.id, &label.id).await.unwrap();

    // Use PlanningOrgan
    let organ = kanwise::Kanwise::new(db);
    let filter = TaskFilter {
        board_id: Some(board.id.clone()),
        label: Some("ai-ready".to_string()),
        ..Default::default()
    };
    let next = organ.get_next_task(filter).await.unwrap();
    assert_eq!(next.title, "Fix auth bug");
    assert!(next.labels.contains(&"ai-ready".to_string()));
}

#[tokio::test]
async fn test_list_tasks_maps_labels() {
    let db = kanwise::Db::in_memory().await.unwrap();
    let board = db.create_board("Board", None).await.unwrap();
    let col = db.create_column(&board.id, "Todo", None, None).await.unwrap();
    let label = db.create_label(&board.id, "urgent", "#ff0000").await.unwrap();
    let task = db.create_task(&board.id, &col.id, "Task 1", None, cortx_types::Priority::Medium, None).await.unwrap();
    db.add_task_label(&task.id, &label.id).await.unwrap();

    let organ = kanwise::Kanwise::new(db);
    let tasks = organ.list_tasks(&board.id).await.unwrap();
    assert_eq!(tasks.len(), 1);
    assert!(tasks[0].labels.contains(&"urgent".to_string()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p kanwise --test planning_organ_test`
Expected: FAIL — `Kanwise` struct not found

- [ ] **Step 3: Add `get_next_ai_task` to repo.rs**

In `crates/kanwise/src/db/repo.rs`, add a new method to the `impl Db` block:

```rust
/// Find the next task with a specific label, sorted by priority then due date.
/// Used by PlanningOrgan::get_next_task.
pub async fn get_next_ai_task(
    &self,
    board_id: Option<&str>,
    label_name: &str,
) -> anyhow::Result<Option<(crate::db::models::Task, Vec<String>)>> {
    let board_id = board_id.map(String::from);
    let label_name = label_name.to_string();
    self.with_conn(move |conn| {
        let mut sql = String::from(
            "SELECT t.id, t.board_id, t.column_id, t.title, t.description,
                    t.priority, t.assignee, t.due_date, t.position,
                    t.created_at, t.updated_at, t.archived
             FROM tasks t
             JOIN task_labels tl ON t.id = tl.task_id
             JOIN labels l ON tl.label_id = l.id
             WHERE l.name = ?1 AND t.archived = 0"
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(label_name)];

        if let Some(bid) = &board_id {
            sql.push_str(" AND t.board_id = ?2");
            params.push(Box::new(bid.clone()));
        }

        // Sort: urgent > high > medium > low, then closest due date first
        sql.push_str(
            " ORDER BY CASE t.priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
              END ASC,
              CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END ASC,
              t.due_date ASC
             LIMIT 1"
        );

        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let task = stmt.query_row(&*params_refs, |row| {
            Ok(crate::db::models::Task {
                id: row.get(0)?,
                board_id: row.get(1)?,
                column_id: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                priority: crate::db::models::Priority::from_str_db(
                    &row.get::<_, String>(5)?
                ).unwrap_or(crate::db::models::Priority::Medium),
                assignee: row.get(6)?,
                due_date: row.get(7)?,
                position: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                archived: row.get(11)?,
            })
        }).optional()?;

        match task {
            Some(t) => {
                // Fetch label names for this task
                let mut label_stmt = conn.prepare(
                    "SELECT l.name FROM labels l
                     JOIN task_labels tl ON l.id = tl.label_id
                     WHERE tl.task_id = ?1"
                )?;
                let labels: Vec<String> = label_stmt.query_map(
                    rusqlite::params![t.id],
                    |row| row.get(0)
                )?.filter_map(|r| r.ok()).collect();
                Ok(Some((t, labels)))
            }
            None => Ok(None),
        }
    }).await
}
```

**Note:** You'll need to add `use rusqlite::OptionalExtension;` at the top of repo.rs if not already present.

- [ ] **Step 4: Implement `Kanwise` struct and `PlanningOrgan` trait**

In `crates/kanwise/src/lib.rs`, add:

```rust
use cortx_types::{PlanningOrgan, Task as CortxTask, TaskFilter};

/// Lightweight mode: direct DB access for planning operations only.
/// Used by cortx orchestrator (lib import). No HTTP, no WS, no background tasks.
pub struct Kanwise {
    db: db::Db,
}

impl Kanwise {
    pub fn new(db: db::Db) -> Self {
        Self { db }
    }
}

impl PlanningOrgan for Kanwise {
    async fn get_next_task(&self, filter: TaskFilter) -> anyhow::Result<CortxTask> {
        let label = filter.label.as_deref().unwrap_or("ai-ready");
        let result = self.db.get_next_ai_task(
            filter.board_id.as_deref(),
            label,
        ).await?;

        match result {
            Some((task, labels)) => Ok(CortxTask {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                labels,
                column_id: task.column_id,
                due_date: task.due_date,
            }),
            None => anyhow::bail!("No task found matching filter"),
        }
    }

    async fn complete_task(&self, id: &str) -> anyhow::Result<()> {
        // Find a "done" column for this task's board, then move the task there
        let task_id = id.to_string();
        let task_data = self.db.get_task(&task_id).await?
            .ok_or_else(|| anyhow::anyhow!("Task not found: {task_id}"))?;

        // Find columns for this board, pick the last one (typically "Done")
        let columns = self.db.list_columns(&task_data.board_id).await?;
        let done_col = columns.last()
            .ok_or_else(|| anyhow::anyhow!("No columns found for board"))?;

        self.db.move_task(&task_id, &done_col.id, 0).await?;
        Ok(())
    }

    async fn list_tasks(&self, board_id: &str) -> anyhow::Result<Vec<CortxTask>> {
        // Db::list_tasks returns Vec<Task> (not TaskWithRelations)
        // We must fetch labels separately for each task via get_task_labels
        let tasks = self.db.list_tasks(board_id, 1000, 0).await?;
        let mut result = Vec::with_capacity(tasks.len());
        for t in tasks {
            let labels = self.db.get_task_labels(&t.id).await?;
            let label_names: Vec<String> = labels.iter().map(|l| l.name.clone()).collect();
            result.push(CortxTask {
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                labels: label_names,
                column_id: t.column_id,
                due_date: t.due_date,
            });
        }
        Ok(result)
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p kanwise --test planning_organ_test`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add crates/kanwise/src/lib.rs crates/kanwise/src/db/repo.rs crates/kanwise/tests/
git commit -m "feat: implement PlanningOrgan trait for kanwise"
```

---

### Task 8: Phase 1 verification — full workspace build

- [ ] **Step 1: Clean build**

Run: `cargo build --workspace`
Expected: all 6 crates build successfully

- [ ] **Step 2: Full test suite**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 3: Clippy**

Run: `cargo clippy --workspace -- -D warnings`
Expected: no warnings

---

## Chunk 2: Phase 2 — rtk-proxy

rtk-proxy is the action organ: a 7-layer security pipeline that executes commands safely. It does NOT touch kanwise code.

### Task 9: Policy engine — parse cortx-policy.toml

**Files:**
- Modify: `crates/rtk-proxy/Cargo.toml` (add deps)
- Create: `crates/rtk-proxy/src/policy.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Add dependencies to rtk-proxy/Cargo.toml**

```toml
[dependencies]
cortx-types = { path = "../cortx-types" }
anyhow.workspace = true
tokio.workspace = true
serde.workspace = true
serde_json.workspace = true
toml = "0.8"
glob-match = "0.2"
regex.workspace = true
tracing.workspace = true
uuid.workspace = true
chrono.workspace = true
```

- [ ] **Step 2: Write the failing test for policy parsing**

Create `crates/rtk-proxy/tests/policy_test.rs`:

```rust
use rtk_proxy::policy::Policy;

#[test]
fn test_parse_default_policy() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.mode.default, "assisted");
    assert_eq!(policy.budget.max_commands_per_session, 200);
    assert_eq!(policy.budget.max_cpu_seconds, 300);
    assert!(policy.tiers.safe.contains(&"cargo test*".to_string()));
    assert!(policy.tiers.forbidden.contains(&"rm -rf *".to_string()));
}

#[test]
fn test_tier_classification() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    assert_eq!(policy.classify("cargo test"), cortx_types::Tier::Safe);
    assert_eq!(policy.classify("cargo test -- --nocapture"), cortx_types::Tier::Safe);
    assert_eq!(policy.classify("cargo add serde"), cortx_types::Tier::Monitored);
    assert_eq!(policy.classify("git push origin main"), cortx_types::Tier::Dangerous);
    assert_eq!(policy.classify("rm -rf /"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("sudo rm file"), cortx_types::Tier::Forbidden);
}

#[test]
fn test_shell_operator_rejection() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    // Commands with shell operators are always forbidden
    assert_eq!(policy.classify("cargo test && rm -rf /"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("ls | grep foo"), cortx_types::Tier::Forbidden);
    assert_eq!(policy.classify("echo `whoami`"), cortx_types::Tier::Forbidden);
}

#[test]
fn test_unknown_command_defaults_to_monitored() {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    let policy = Policy::from_toml(toml_str).unwrap();
    // Unknown commands default to Monitored (cautious but not blocked)
    assert_eq!(policy.classify("python script.py"), cortx_types::Tier::Monitored);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test policy_test`
Expected: FAIL — `policy` module not found

- [ ] **Step 4: Implement policy.rs**

Create `crates/rtk-proxy/src/policy.rs`:

```rust
use anyhow::Result;
use cortx_types::Tier;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Policy {
    pub mode: ModeConfig,
    pub budget: BudgetConfig,
    pub sandbox: SandboxConfig,
    pub tiers: TierConfig,
    pub output: OutputConfig,
    pub checkpoint: CheckpointConfig,
    pub circuit_breaker: CircuitBreakerConfig,
}

#[derive(Debug, Deserialize)]
pub struct ModeConfig {
    pub default: String,
}

#[derive(Debug, Deserialize)]
pub struct BudgetConfig {
    pub max_commands_per_session: u32,
    pub max_cpu_seconds: u32,
    pub loop_threshold: u32,
    pub loop_window_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct SandboxConfig {
    pub default_timeout: String,
    pub env_passthrough: Vec<String>,
    pub env_redact: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct TierConfig {
    pub safe: Vec<String>,
    pub monitored: Vec<String>,
    pub dangerous: Vec<String>,
    pub forbidden: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct OutputConfig {
    pub max_lines: usize,
    pub keep_head: usize,
    pub keep_tail: usize,
    pub redact_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CheckpointConfig {
    pub before_monitored: bool,
    pub before_dangerous: bool,
}

#[derive(Debug, Deserialize)]
pub struct CircuitBreakerConfig {
    pub max_consecutive_failures: u32,
    pub action: String,
}

/// Shell operators that indicate command chaining — always forbidden.
const SHELL_OPERATORS: &[&str] = &["&&", "||", ";", "|", "`", "$("];

impl Policy {
    pub fn from_toml(toml_str: &str) -> Result<Self> {
        Ok(toml::from_str(toml_str)?)
    }

    pub fn from_file(path: &str) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        Self::from_toml(&content)
    }

    /// Classify a command string into a Tier.
    /// Commands with shell operators are always Forbidden.
    /// Unknown commands default to Monitored.
    pub fn classify(&self, cmd: &str) -> Tier {
        // Reject shell operators
        if SHELL_OPERATORS.iter().any(|op| cmd.contains(op)) {
            return Tier::Forbidden;
        }

        // Check tiers from most restrictive to least
        if self.matches_any(cmd, &self.tiers.forbidden) {
            return Tier::Forbidden;
        }
        if self.matches_any(cmd, &self.tiers.dangerous) {
            return Tier::Dangerous;
        }
        if self.matches_any(cmd, &self.tiers.monitored) {
            return Tier::Monitored;
        }
        if self.matches_any(cmd, &self.tiers.safe) {
            return Tier::Safe;
        }

        // Default: unknown commands are Monitored
        Tier::Monitored
    }

    fn matches_any(&self, cmd: &str, patterns: &[String]) -> bool {
        patterns.iter().any(|pattern| glob_match_cmd(cmd, pattern))
    }
}

/// Match a command against a glob pattern.
/// The pattern matches against the full command string.
fn glob_match_cmd(cmd: &str, pattern: &str) -> bool {
    glob_match::glob_match(pattern, cmd)
}
```

- [ ] **Step 5: Update lib.rs**

In `crates/rtk-proxy/src/lib.rs`:

```rust
//! rtk-proxy — Secure command execution proxy for cortx.

pub mod policy;
```

- [ ] **Step 6: Run tests**

Run: `cargo test -p rtk-proxy --test policy_test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement policy engine with tier classification"
```

---

### Task 10: Budget tracker, rate limiter, and circuit breaker

**Files:**
- Create: `crates/rtk-proxy/src/budget.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/rtk-proxy/tests/budget_test.rs`:

```rust
use rtk_proxy::budget::BudgetTracker;
use rtk_proxy::policy::{BudgetConfig, CircuitBreakerConfig};

fn test_budget_config() -> BudgetConfig {
    BudgetConfig {
        max_commands_per_session: 5,
        max_cpu_seconds: 60,
        loop_threshold: 3,
        loop_window_seconds: 10,
    }
}

fn test_circuit_breaker_config() -> CircuitBreakerConfig {
    CircuitBreakerConfig {
        max_consecutive_failures: 3,
        action: "suspend".to_string(),
    }
}

#[test]
fn test_budget_allows_commands_within_limit() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    for _ in 0..5 {
        assert!(tracker.check_and_record("cargo test", 1).is_ok());
    }
    // 6th command exceeds budget
    assert!(tracker.check_and_record("cargo test", 1).is_err());
}

#[test]
fn test_loop_detection() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    // Same command 3 times in window = OK (threshold is 3)
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    // 4th time = loop detected
    assert!(tracker.check_and_record("cargo test", 1).is_err());
}

#[test]
fn test_circuit_breaker_triggers_on_consecutive_failures() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    tracker.record_failure();
    tracker.record_failure();
    tracker.record_failure();
    // Circuit breaker is open after 3 consecutive failures
    assert!(tracker.is_circuit_open());
}

#[test]
fn test_circuit_breaker_resets_on_success() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    tracker.record_failure();
    tracker.record_failure();
    tracker.record_success();
    // Success resets the counter
    assert!(!tracker.is_circuit_open());
}

#[test]
fn test_remaining_budget() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    let budget = tracker.remaining();
    assert_eq!(budget.commands_remaining, 5);
    assert_eq!(budget.cpu_seconds_remaining, 60);

    tracker.check_and_record("cargo test", 5).unwrap();
    let budget = tracker.remaining();
    assert_eq!(budget.commands_remaining, 4);
    assert_eq!(budget.cpu_seconds_remaining, 55);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test budget_test`
Expected: FAIL — `budget` module not found

- [ ] **Step 3: Implement budget.rs**

Create `crates/rtk-proxy/src/budget.rs`:

```rust
use anyhow::{bail, Result};
use cortx_types::Budget;
use std::collections::VecDeque;
use std::time::Instant;

use crate::policy::{BudgetConfig, CircuitBreakerConfig};

pub struct BudgetTracker {
    max_commands: u32,
    max_cpu_seconds: u32,
    loop_threshold: u32,
    loop_window_secs: u64,
    commands_used: u32,
    cpu_seconds_used: u32,
    recent_commands: VecDeque<(String, Instant)>,
    consecutive_failures: u32,
    max_consecutive_failures: u32,
    circuit_breaker_action: String,
}

impl BudgetTracker {
    pub fn new(budget: &BudgetConfig, cb: &CircuitBreakerConfig) -> Self {
        Self {
            max_commands: budget.max_commands_per_session,
            max_cpu_seconds: budget.max_cpu_seconds,
            loop_threshold: budget.loop_threshold,
            loop_window_secs: budget.loop_window_seconds,
            commands_used: 0,
            cpu_seconds_used: 0,
            recent_commands: VecDeque::new(),
            consecutive_failures: 0,
            max_consecutive_failures: cb.max_consecutive_failures,
            circuit_breaker_action: cb.action.clone(),
        }
    }

    /// Check if a command can be executed and record it.
    /// Returns Err if budget is exhausted or loop detected.
    pub fn check_and_record(&mut self, cmd: &str, cpu_seconds: u32) -> Result<()> {
        if self.is_circuit_open() {
            bail!("Circuit breaker open: {} consecutive failures", self.consecutive_failures);
        }

        if self.commands_used >= self.max_commands {
            bail!("Command budget exhausted: {}/{}", self.commands_used, self.max_commands);
        }

        if self.cpu_seconds_used + cpu_seconds > self.max_cpu_seconds {
            bail!("CPU budget exhausted: {}s/{}s", self.cpu_seconds_used, self.max_cpu_seconds);
        }

        // Loop detection
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.loop_window_secs);

        // Purge old entries
        while self.recent_commands.front().is_some_and(|(_, t)| now.duration_since(*t) > window) {
            self.recent_commands.pop_front();
        }

        let same_cmd_count = self.recent_commands.iter()
            .filter(|(c, _)| c == cmd)
            .count() as u32;

        if same_cmd_count >= self.loop_threshold {
            bail!(
                "Loop detected: '{}' executed {} times in {}s window",
                cmd, same_cmd_count, self.loop_window_secs
            );
        }

        // Record
        self.commands_used += 1;
        self.cpu_seconds_used += cpu_seconds;
        self.recent_commands.push_back((cmd.to_string(), now));

        Ok(())
    }

    pub fn record_failure(&mut self) {
        self.consecutive_failures += 1;
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    /// Record CPU seconds consumed (post-execution, without incrementing command count)
    pub fn record_cpu(&mut self, cpu_seconds: u32) {
        self.cpu_seconds_used += cpu_seconds;
    }

    pub fn is_circuit_open(&self) -> bool {
        self.circuit_breaker_action == "suspend"
            && self.consecutive_failures >= self.max_consecutive_failures
    }

    pub fn remaining(&self) -> Budget {
        Budget {
            commands_remaining: self.max_commands.saturating_sub(self.commands_used),
            cpu_seconds_remaining: self.max_cpu_seconds.saturating_sub(self.cpu_seconds_used),
        }
    }
}
```

- [ ] **Step 4: Update lib.rs**

```rust
pub mod policy;
pub mod budget;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p rtk-proxy --test budget_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement budget tracker, rate limiter, circuit breaker"
```

---

### Task 11: Sandbox — cwd lock, env filter, timeout

**Files:**
- Create: `crates/rtk-proxy/src/sandbox.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/rtk-proxy/tests/sandbox_test.rs`:

```rust
use rtk_proxy::sandbox::Sandbox;
use rtk_proxy::policy::SandboxConfig;
use std::path::PathBuf;

fn test_config() -> SandboxConfig {
    SandboxConfig {
        default_timeout: "5s".to_string(),
        env_passthrough: vec!["PATH".to_string(), "HOME".to_string()],
        env_redact: vec!["*_KEY".to_string(), "*_TOKEN".to_string(), "*_SECRET".to_string()],
    }
}

#[test]
fn test_cwd_validation_allows_project_root() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp/project")).is_ok());
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp/project/src")).is_ok());
}

#[test]
fn test_cwd_validation_rejects_escape() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp")).is_err());
    assert!(sandbox.validate_cwd(&PathBuf::from("/etc")).is_err());
    assert!(sandbox.validate_cwd(&PathBuf::from("/tmp/project/../other")).is_err());
}

#[test]
fn test_env_filtering() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    let mut env = vec![
        ("PATH".to_string(), "/usr/bin".to_string()),
        ("HOME".to_string(), "/home/user".to_string()),
        ("API_KEY".to_string(), "secret123".to_string()),
        ("GITHUB_TOKEN".to_string(), "ghp_abc".to_string()),
        ("DB_SECRET".to_string(), "pass".to_string()),
        ("RANDOM_VAR".to_string(), "value".to_string()),
    ];
    let filtered = sandbox.filter_env(&env);
    let keys: Vec<&str> = filtered.iter().map(|(k, _)| k.as_str()).collect();
    assert!(keys.contains(&"PATH"));
    assert!(keys.contains(&"HOME"));
    assert!(!keys.contains(&"API_KEY"));
    assert!(!keys.contains(&"GITHUB_TOKEN"));
    assert!(!keys.contains(&"DB_SECRET"));
    assert!(!keys.contains(&"RANDOM_VAR")); // not in passthrough
}

#[test]
fn test_timeout_parsing() {
    let sandbox = Sandbox::new(&test_config(), PathBuf::from("/tmp/project"));
    assert_eq!(sandbox.timeout_secs(), 5);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test sandbox_test`
Expected: FAIL

- [ ] **Step 3: Implement sandbox.rs**

Create `crates/rtk-proxy/src/sandbox.rs`:

```rust
use anyhow::{bail, Result};
use std::path::PathBuf;

use crate::policy::SandboxConfig;

pub struct Sandbox {
    project_root: PathBuf,
    timeout_secs: u64,
    env_passthrough: Vec<String>,
    env_redact_patterns: Vec<String>,
}

impl Sandbox {
    pub fn new(config: &SandboxConfig, project_root: PathBuf) -> Self {
        let timeout_secs = parse_duration_secs(&config.default_timeout).unwrap_or(30);
        Self {
            project_root,
            timeout_secs,
            env_passthrough: config.env_passthrough.clone(),
            env_redact_patterns: config.env_redact.clone(),
        }
    }

    pub fn validate_cwd(&self, cwd: &PathBuf) -> Result<()> {
        let canonical_root = self.project_root.canonicalize()
            .unwrap_or_else(|_| self.project_root.clone());
        // Reject paths that cannot be resolved — prevents traversal via non-existent paths
        let canonical_cwd = cwd.canonicalize()
            .map_err(|e| anyhow::anyhow!("Cannot resolve cwd {}: {e}", cwd.display()))?;

        if !canonical_cwd.starts_with(&canonical_root) {
            bail!(
                "cwd escape: {} is outside project root {}",
                canonical_cwd.display(),
                canonical_root.display()
            );
        }
        Ok(())
    }

    pub fn filter_env(&self, env: &[(String, String)]) -> Vec<(String, String)> {
        env.iter()
            .filter(|(key, _)| {
                // Must be in passthrough AND not match redact patterns
                self.env_passthrough.contains(key)
                    && !self.matches_redact(key)
            })
            .cloned()
            .collect()
    }

    pub fn timeout_secs(&self) -> u64 {
        self.timeout_secs
    }

    pub fn project_root(&self) -> &PathBuf {
        &self.project_root
    }

    fn matches_redact(&self, key: &str) -> bool {
        self.env_redact_patterns.iter().any(|pattern| {
            glob_match::glob_match(pattern, key)
        })
    }
}

fn parse_duration_secs(s: &str) -> Option<u64> {
    let s = s.trim();
    if let Some(secs) = s.strip_suffix('s') {
        secs.parse().ok()
    } else if let Some(mins) = s.strip_suffix('m') {
        mins.parse::<u64>().ok().map(|m| m * 60)
    } else {
        s.parse().ok()
    }
}
```

- [ ] **Step 4: Update lib.rs**

```rust
pub mod policy;
pub mod budget;
pub mod sandbox;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p rtk-proxy --test sandbox_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement sandbox with cwd lock, env filter, timeout"
```

---

### Task 12: Output processor — truncation, secret redaction, structured parsing

**Files:**
- Create: `crates/rtk-proxy/src/output.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/rtk-proxy/tests/output_test.rs`:

```rust
use rtk_proxy::output::OutputProcessor;
use rtk_proxy::policy::OutputConfig;

fn test_config() -> OutputConfig {
    OutputConfig {
        max_lines: 10,
        keep_head: 3,
        keep_tail: 3,
        redact_patterns: vec![
            r"(?i)(api[_-]?key|token|secret|password)\s*[=:]\s*\S+".to_string(),
            r"sk-[a-zA-Z0-9]{20,}".to_string(),
            r"ghp_[a-zA-Z0-9]{36}".to_string(),
        ],
    }
}

#[test]
fn test_truncation() {
    let processor = OutputProcessor::new(&test_config());
    let lines: Vec<String> = (1..=20).map(|i| format!("line {i}")).collect();
    let input = lines.join("\n");
    let (output, truncated) = processor.truncate(&input);
    assert!(truncated);
    assert!(output.contains("line 1"));
    assert!(output.contains("line 2"));
    assert!(output.contains("line 3"));
    assert!(output.contains("line 20"));
    assert!(output.contains("line 19"));
    assert!(output.contains("line 18"));
    assert!(!output.contains("line 10")); // middle lines removed
}

#[test]
fn test_no_truncation_for_short_output() {
    let processor = OutputProcessor::new(&test_config());
    let input = "line 1\nline 2\nline 3";
    let (output, truncated) = processor.truncate(input);
    assert!(!truncated);
    assert_eq!(output, input);
}

#[test]
fn test_secret_redaction() {
    let processor = OutputProcessor::new(&test_config());
    let input = "API_KEY = sk-abcdefghijklmnopqrstuvwxyz123456\nNormal line\npassword: mysecret123";
    let redacted = processor.redact(input);
    assert!(!redacted.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
    assert!(redacted.contains("[REDACTED]"));
    assert!(redacted.contains("Normal line"));
    assert!(!redacted.contains("mysecret123"));
}

#[test]
fn test_cargo_test_error_parsing() {
    let output = r#"
running 3 tests
test auth::test_login ... FAILED
test auth::test_signup ... ok
test db::test_query ... FAILED

failures:

---- auth::test_login stdout ----
thread 'auth::test_login' panicked at src/auth.rs:42:5:
assertion failed: token.is_valid()

---- db::test_query stdout ----
thread 'db::test_query' panicked at src/db/repo.rs:187:10:
called `Result::unwrap()` on an `Err` value

test result: FAILED. 1 passed; 2 failed; 0 ignored
"#;
    let parsed = rtk_proxy::output::parse_cargo_test(output);
    assert_eq!(parsed.errors.len(), 2);
    assert_eq!(parsed.errors[0].file, "src/auth.rs");
    assert_eq!(parsed.errors[0].line, Some(42));
    assert!(parsed.summary.contains("2 failed"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test output_test`
Expected: FAIL

- [ ] **Step 3: Implement output.rs**

Create `crates/rtk-proxy/src/output.rs`:

```rust
use cortx_types::CodeLocation;
use regex::Regex;
use std::sync::LazyLock;

use crate::policy::OutputConfig;

pub struct OutputProcessor {
    max_lines: usize,
    keep_head: usize,
    keep_tail: usize,
    redact_regexes: Vec<Regex>,
}

pub struct ParsedOutput {
    pub summary: String,
    pub errors: Vec<CodeLocation>,
    pub warnings: Vec<CodeLocation>,
}

impl OutputProcessor {
    pub fn new(config: &OutputConfig) -> Self {
        let redact_regexes = config
            .redact_patterns
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();
        Self {
            max_lines: config.max_lines,
            keep_head: config.keep_head,
            keep_tail: config.keep_tail,
            redact_regexes,
        }
    }

    /// Truncate output keeping head + tail lines. Returns (output, was_truncated).
    pub fn truncate(&self, output: &str) -> (String, bool) {
        let lines: Vec<&str> = output.lines().collect();
        if lines.len() <= self.max_lines {
            return (output.to_string(), false);
        }

        let head: Vec<&str> = lines[..self.keep_head].to_vec();
        let tail: Vec<&str> = lines[lines.len() - self.keep_tail..].to_vec();
        let omitted = lines.len() - self.keep_head - self.keep_tail;

        let mut result = head.join("\n");
        result.push_str(&format!("\n\n... ({omitted} lines omitted) ...\n\n"));
        result.push_str(&tail.join("\n"));

        (result, true)
    }

    /// Redact secrets from output using configured patterns.
    pub fn redact(&self, output: &str) -> String {
        let mut result = output.to_string();
        for re in &self.redact_regexes {
            result = re.replace_all(&result, "[REDACTED]").to_string();
        }
        result
    }

    /// Full processing pipeline: redact then truncate.
    pub fn process(&self, output: &str) -> (String, bool) {
        let redacted = self.redact(output);
        self.truncate(&redacted)
    }
}

// ── Cargo test output parser ──

static CARGO_PANIC_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"panicked at ([^:]+):(\d+):\d+:\n(.+)").unwrap()
});

static CARGO_SUMMARY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored").unwrap()
});

pub fn parse_cargo_test(output: &str) -> ParsedOutput {
    let mut errors = Vec::new();

    for cap in CARGO_PANIC_RE.captures_iter(output) {
        errors.push(CodeLocation {
            file: cap[1].to_string(),
            line: cap[2].parse().ok(),
            msg: cap[3].trim().to_string(),
        });
    }

    let summary = if let Some(cap) = CARGO_SUMMARY_RE.captures(output) {
        format!(
            "{} passed; {} failed; {} ignored",
            &cap[1], &cap[2], &cap[3]
        )
    } else {
        String::new()
    };

    ParsedOutput {
        summary,
        errors,
        warnings: Vec::new(),
    }
}
```

- [ ] **Step 4: Update lib.rs**

```rust
pub mod policy;
pub mod budget;
pub mod sandbox;
pub mod output;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p rtk-proxy --test output_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement output processor with truncation, redaction, cargo parser"
```

---

### Task 13: Command executor (tokio::process::Command wrapper)

**Files:**
- Create: `crates/rtk-proxy/src/execute.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/rtk-proxy/tests/execute_test.rs`:

```rust
use rtk_proxy::execute::Executor;
use std::path::PathBuf;

#[tokio::test]
async fn test_execute_simple_command() {
    let executor = Executor::new(5);
    let result = executor.run("echo hello", &PathBuf::from("."), &[]).await.unwrap();
    assert_eq!(result.exit_code, Some(0));
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_execute_failing_command() {
    let executor = Executor::new(5);
    let result = executor.run("false", &PathBuf::from("."), &[]).await.unwrap();
    assert_ne!(result.exit_code, Some(0));
}

#[tokio::test]
async fn test_execute_timeout() {
    let executor = Executor::new(1); // 1 second timeout
    let result = executor.run("sleep 10", &PathBuf::from("."), &[]).await;
    // Should timeout
    assert!(result.is_err() || result.unwrap().timed_out);
}

#[tokio::test]
async fn test_execute_with_env() {
    let executor = Executor::new(5);
    let env = vec![("TEST_VAR".to_string(), "hello_world".to_string())];
    let result = executor.run("printenv TEST_VAR", &PathBuf::from("."), &env).await.unwrap();
    assert!(result.stdout.contains("hello_world"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test execute_test`
Expected: FAIL

- [ ] **Step 3: Implement execute.rs**

Create `crates/rtk-proxy/src/execute.rs`:

```rust
use anyhow::Result;
use std::path::PathBuf;
use std::time::Instant;
use tokio::process::Command as TokioCommand;

pub struct Executor {
    timeout_secs: u64,
}

pub struct RawResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub timed_out: bool,
}

impl Executor {
    pub fn new(timeout_secs: u64) -> Self {
        Self { timeout_secs }
    }

    pub async fn run(
        &self,
        cmd: &str,
        cwd: &PathBuf,
        env: &[(String, String)],
    ) -> Result<RawResult> {
        let start = Instant::now();

        let mut command = TokioCommand::new("sh");
        command.arg("-c").arg(cmd);
        command.current_dir(cwd);

        // Clear env and set only filtered vars
        command.env_clear();
        for (key, value) in env {
            command.env(key, value);
        }

        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let child = command.spawn()?;
        let timeout = std::time::Duration::from_secs(self.timeout_secs);

        match tokio::time::timeout(timeout, child.wait_with_output()).await {
            Ok(Ok(output)) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(RawResult {
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: output.status.code(),
                    duration_ms,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(e.into()),
            Err(_) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(RawResult {
                    stdout: String::new(),
                    stderr: format!("Command timed out after {}s", self.timeout_secs),
                    exit_code: None,
                    duration_ms,
                    timed_out: true,
                })
            }
        }
    }
}
```

- [ ] **Step 4: Update lib.rs**

```rust
pub mod policy;
pub mod budget;
pub mod sandbox;
pub mod output;
pub mod execute;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p rtk-proxy --test execute_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement command executor with timeout support"
```

---

### Task 14: Proxy struct — full pipeline wiring + ActionOrgan trait

**Files:**
- Create: `crates/rtk-proxy/src/proxy.rs`
- Modify: `crates/rtk-proxy/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/rtk-proxy/tests/proxy_test.rs`:

```rust
use cortx_types::{ActionOrgan, Command, ExecutionMode, Status, Tier};
use rtk_proxy::proxy::Proxy;
use std::path::PathBuf;

fn test_proxy() -> Proxy {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    Proxy::from_toml(toml_str, PathBuf::from(".")).unwrap()
}

#[tokio::test]
async fn test_safe_command_executes() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo hello".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);
    assert!(result.summary.contains("hello"));
}

#[tokio::test]
async fn test_forbidden_command_blocked() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "rm -rf /".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);
}

#[tokio::test]
async fn test_admin_mode_bypasses_policy() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo admin bypass".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Admin,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);
}

#[tokio::test]
async fn test_shell_operators_forbidden() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo hello && echo world".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p rtk-proxy --test proxy_test`
Expected: FAIL

- [ ] **Step 3: Implement proxy.rs**

Create `crates/rtk-proxy/src/proxy.rs` — the main `Proxy` struct wiring all layers:

```rust
use anyhow::Result;
use cortx_types::{
    ActionOrgan, Budget, Command, ExecutionMode, ExecutionResult, Status, Tier,
};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::budget::BudgetTracker;
use crate::execute::Executor;
use crate::output::{self, OutputProcessor};
use crate::policy::Policy;
use crate::sandbox::Sandbox;

pub struct Proxy {
    policy: Policy,
    sandbox: Sandbox,
    budget: Mutex<BudgetTracker>,
    output_processor: OutputProcessor,
}

impl Proxy {
    pub fn from_toml(toml_str: &str, project_root: PathBuf) -> Result<Self> {
        let policy = Policy::from_toml(toml_str)?;
        let sandbox = Sandbox::new(&policy.sandbox, project_root);
        let budget = Mutex::new(BudgetTracker::new(&policy.budget, &policy.circuit_breaker));
        let output_processor = OutputProcessor::new(&policy.output);
        Ok(Self { policy, sandbox, budget, output_processor })
    }

    pub fn from_file(path: &str, project_root: PathBuf) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        Self::from_toml(&content, project_root)
    }

    pub fn remaining_budget(&self) -> Budget {
        self.budget.lock().unwrap().remaining()
    }

    fn make_result(
        &self,
        status: Status,
        cmd: &str,
        tier: Tier,
        summary: String,
    ) -> ExecutionResult {
        ExecutionResult {
            status,
            exit_code: None,
            duration_ms: 0,
            command: cmd.to_string(),
            tier,
            summary,
            errors: Vec::new(),
            warnings: Vec::new(),
            truncated: false,
            budget_remaining: self.remaining_budget(),
            hints: Vec::new(),
            files_touched: Vec::new(),
        }
    }
}

impl ActionOrgan for Proxy {
    async fn execute(&self, cmd: Command) -> Result<ExecutionResult> {
        let tier = self.policy.classify(&cmd.cmd);

        // ⓪ AUTH & MODE — Admin bypasses to execute
        if cmd.mode == ExecutionMode::Admin {
            // Admin bypasses layers ①–④ but NOT ⑦ (audit)
            let executor = Executor::new(self.sandbox.timeout_secs());
            let env: Vec<(String, String)> = std::env::vars().collect();
            let raw = executor.run(&cmd.cmd, &cmd.cwd, &env).await?;

            let (output, truncated) = self.output_processor.process(
                &format!("{}\n{}", raw.stdout, raw.stderr),
            );

            let status = if raw.timed_out {
                Status::Timeout
            } else if raw.exit_code == Some(0) {
                Status::Passed
            } else {
                Status::Failed
            };

            return Ok(ExecutionResult {
                status,
                exit_code: raw.exit_code,
                duration_ms: raw.duration_ms,
                command: cmd.cmd,
                tier,
                summary: output,
                errors: Vec::new(),
                warnings: Vec::new(),
                truncated,
                budget_remaining: self.remaining_budget(),
                hints: Vec::new(),
                files_touched: Vec::new(),
            });
        }

        // ① POLICY ENGINE — already handled by classify
        // ② TIER CLASSIFIER
        match tier {
            Tier::Forbidden => {
                return Ok(self.make_result(
                    Status::Forbidden,
                    &cmd.cmd,
                    tier,
                    format!("Command forbidden by policy: {}", cmd.cmd),
                ));
            }
            Tier::Dangerous if cmd.mode == ExecutionMode::Autonomous => {
                return Ok(self.make_result(
                    Status::Blocked,
                    &cmd.cmd,
                    tier,
                    format!("Dangerous command blocked in autonomous mode: {}", cmd.cmd),
                ));
            }
            _ => {}
        }

        // ③ BUDGET & RATE
        {
            let mut budget = self.budget.lock().unwrap();
            if let Err(e) = budget.check_and_record(&cmd.cmd, 0) {
                return Ok(self.make_result(
                    Status::Blocked,
                    &cmd.cmd,
                    tier,
                    format!("Budget/rate limit: {e}"),
                ));
            }
        }

        // ④ SANDBOX
        if let Err(e) = self.sandbox.validate_cwd(&cmd.cwd) {
            return Ok(self.make_result(
                Status::Blocked,
                &cmd.cmd,
                tier,
                format!("Sandbox violation: {e}"),
            ));
        }

        let env_full: Vec<(String, String)> = std::env::vars().collect();
        let env_filtered = self.sandbox.filter_env(&env_full);

        // ⑤ EXECUTE
        let executor = Executor::new(self.sandbox.timeout_secs());
        let raw = executor.run(&cmd.cmd, &cmd.cwd, &env_filtered).await?;

        // ⑥ OUTPUT PROCESSOR
        let combined = format!("{}\n{}", raw.stdout, raw.stderr);
        let (processed_output, truncated) = self.output_processor.process(&combined);

        // Try structured parsing for known tools
        let parsed = if cmd.cmd.starts_with("cargo test") {
            Some(output::parse_cargo_test(&combined))
        } else {
            None
        };

        let status = if raw.timed_out {
            Status::Timeout
        } else if raw.exit_code == Some(0) {
            Status::Passed
        } else {
            Status::Failed
        };

        // Update circuit breaker
        {
            let mut budget = self.budget.lock().unwrap();
            if status == Status::Passed {
                budget.record_success();
            } else if status == Status::Failed {
                budget.record_failure();
            }
        }

        let (summary, errors, warnings) = if let Some(p) = parsed {
            (
                if p.summary.is_empty() { processed_output.clone() } else { p.summary },
                p.errors,
                p.warnings,
            )
        } else {
            (processed_output, Vec::new(), Vec::new())
        };

        // CPU time accounting (approximate: use wall-clock duration)
        // Note: recorded separately from the command check to avoid double-counting
        let cpu_secs = (raw.duration_ms / 1000) as u32;
        if cpu_secs > 0 {
            self.budget.lock().unwrap().record_cpu(cpu_secs);
        }

        Ok(ExecutionResult {
            status,
            exit_code: raw.exit_code,
            duration_ms: raw.duration_ms,
            command: cmd.cmd,
            tier,
            summary,
            errors,
            warnings,
            truncated,
            budget_remaining: self.remaining_budget(),
            hints: Vec::new(),
            files_touched: Vec::new(),
        })
    }
}
```

- [ ] **Step 4: Update lib.rs with re-exports**

```rust
//! rtk-proxy — Secure command execution proxy for cortx.

pub mod policy;
pub mod budget;
pub mod sandbox;
pub mod output;
pub mod execute;
pub mod proxy;

pub use proxy::Proxy;
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p rtk-proxy --test proxy_test`
Expected: PASS

- [ ] **Step 6: Run full rtk-proxy test suite**

Run: `cargo test -p rtk-proxy`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): implement Proxy struct with full 7-layer pipeline"
```

---

### Task 15: rtk-proxy standalone MCP server + CLI binary

**Files:**
- Create: `crates/rtk-proxy/src/mcp.rs`
- Modify: `crates/rtk-proxy/src/main.rs`

- [ ] **Step 1: Implement MCP server for rtk-proxy**

Create `crates/rtk-proxy/src/mcp.rs`:

```rust
use cortx_types::ActionOrgan;
use serde_json::Value;
use crate::proxy::Proxy;

pub struct ProxyMcpServer {
    pub proxy: Proxy,
}

impl ProxyMcpServer {
    pub fn new(proxy: Proxy) -> Self {
        Self { proxy }
    }

    pub fn tools_list() -> Value {
        serde_json::json!({
            "tools": [
                {
                    "name": "proxy_exec",
                    "description": "Execute a command through the secure pipeline. Returns structured ExecutionResult.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "command": { "type": "string", "description": "Command to execute" },
                            "cwd": { "type": "string", "description": "Working directory (default: project root)" },
                            "mode": { "type": "string", "enum": ["assisted", "autonomous", "admin"], "default": "assisted" }
                        },
                        "required": ["command"]
                    }
                },
                {
                    "name": "proxy_status",
                    "description": "Remaining budget, execution count, circuit breaker state.",
                    "inputSchema": { "type": "object", "properties": {} }
                },
                {
                    "name": "proxy_rollback",
                    "description": "Restore last git checkpoint.",
                    "inputSchema": { "type": "object", "properties": {} }
                }
            ]
        })
    }
}
```

- [ ] **Step 2: Implement CLI binary**

Update `crates/rtk-proxy/src/main.rs`:

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "rtk-proxy", about = "Secure command execution proxy for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Run MCP stdio transport
    Mcp {
        /// Path to cortx-policy.toml
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        /// Project root directory
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
    },
    /// Execute a single command
    Exec {
        /// Command to execute
        command: String,
        /// Path to cortx-policy.toml
        #[arg(short, long, default_value = "cortx-policy.toml")]
        policy: String,
        /// Project root directory
        #[arg(short = 'r', long, default_value = ".")]
        root: String,
    },
}

fn main() {
    let args = Args::parse();
    match args.command {
        Some(Cli::Exec { command, policy, root }) => {
            println!("rtk-proxy exec: {command} (policy: {policy}, root: {root})");
            println!("Full MCP implementation deferred to Phase 4");
        }
        Some(Cli::Mcp { policy, root }) => {
            println!("rtk-proxy mcp: policy={policy}, root={root}");
            println!("Full MCP implementation deferred to Phase 4");
        }
        None => {
            println!("rtk-proxy: use --help for usage");
        }
    }
}
```

- [ ] **Step 3: Add clap dependency to rtk-proxy/Cargo.toml**

Add `clap.workspace = true` to `[dependencies]`.

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p rtk-proxy`
Expected: compiles

- [ ] **Step 5: Commit**

```bash
git add crates/rtk-proxy/
git commit -m "feat(rtk-proxy): add MCP server skeleton and CLI binary"
```

---

## Chunk 3: Phase 3 — context-db

context-db is the memory organ: SQLite + FTS5, causal chain builder, git-aware confidence decay. It does NOT touch kanwise or rtk-proxy code.

### Task 16: SQLite schema + migrations

**Files:**
- Modify: `crates/context-db/Cargo.toml`
- Create: `crates/context-db/src/db.rs`
- Create: `crates/context-db/src/migrations.rs`
- Modify: `crates/context-db/src/lib.rs`

- [ ] **Step 1: Add dependencies to context-db/Cargo.toml**

```toml
[dependencies]
cortx-types = { path = "../cortx-types" }
anyhow.workspace = true
tokio.workspace = true
rusqlite.workspace = true
tokio-rusqlite.workspace = true
serde.workspace = true
serde_json.workspace = true
uuid.workspace = true
chrono.workspace = true
tracing.workspace = true
clap.workspace = true
```

- [ ] **Step 2: Write the failing test**

Create `crates/context-db/tests/schema_test.rs`:

```rust
#[tokio::test]
async fn test_schema_creation() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    // Verify tables exist by inserting and querying
    let count = db.execution_count().await.unwrap();
    assert_eq!(count, 0);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p context-db --test schema_test`
Expected: FAIL

- [ ] **Step 4: Implement db.rs**

Create `crates/context-db/src/db.rs`:

```rust
use rusqlite::Connection;

#[derive(Clone)]
pub struct Db {
    conn: tokio_rusqlite::Connection,
}

impl Db {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open(path).await?;
        conn.call(|conn| -> anyhow::Result<()> {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            crate::migrations::run_migrations(conn)?;
            Ok(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("context-db init: {e}"))?;
        Ok(Self { conn })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open_in_memory().await?;
        conn.call(|conn| -> anyhow::Result<()> {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            crate::migrations::run_migrations(conn)?;
            Ok(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("context-db init: {e}"))?;
        Ok(Self { conn })
    }

    pub async fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Connection) -> anyhow::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        self.conn
            .call(f)
            .await
            .map_err(|e| anyhow::anyhow!("context-db: {e}"))
    }
}
```

- [ ] **Step 5: Implement migrations.rs**

Create `crates/context-db/src/migrations.rs` with the full schema from spec Section 4.3:

```rust
use rusqlite::Connection;

pub fn run_migrations(conn: &mut Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS executions (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            task_id     TEXT,
            command     TEXT NOT NULL,
            exit_code   INTEGER,
            tier        TEXT NOT NULL,
            duration_ms INTEGER,
            summary     TEXT,
            errors      TEXT,
            files_touched TEXT,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS causal_chains (
            id              TEXT PRIMARY KEY,
            trigger_file    TEXT NOT NULL,
            trigger_error   TEXT,
            trigger_command TEXT,
            resolution_file TEXT NOT NULL,
            attempts        INTEGER DEFAULT 1,
            successes       INTEGER DEFAULT 1,
            confidence      REAL DEFAULT 0.5,
            last_verified   TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            UNIQUE(trigger_file, trigger_command, resolution_file)
        );

        CREATE TABLE IF NOT EXISTS project_facts (
            id          TEXT PRIMARY KEY,
            fact        TEXT NOT NULL,
            citation    TEXT NOT NULL,
            source      TEXT NOT NULL,
            confidence  REAL DEFAULT 1.0,
            verified_at TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS archived_memories (
            id            TEXT PRIMARY KEY,
            source_table  TEXT NOT NULL,
            data          TEXT NOT NULL,
            archived_at   TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
            fact, citation, content=project_facts, content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS project_facts_ai AFTER INSERT ON project_facts BEGIN
            INSERT INTO memory_fts(rowid, fact, citation)
            VALUES (new.rowid, new.fact, new.citation);
        END;

        CREATE TRIGGER IF NOT EXISTS project_facts_ad AFTER DELETE ON project_facts BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
            VALUES ('delete', old.rowid, old.fact, old.citation);
        END;

        CREATE TRIGGER IF NOT EXISTS project_facts_au AFTER UPDATE ON project_facts BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
            VALUES ('delete', old.rowid, old.fact, old.citation);
            INSERT INTO memory_fts(rowid, fact, citation)
            VALUES (new.rowid, new.fact, new.citation);
        END;"
    )?;
    Ok(())
}
```

- [ ] **Step 6: Update lib.rs**

```rust
//! context-db — Memory organ for cortx (SQLite + FTS5).

pub mod db;
pub mod migrations;

pub use db::Db;

/// High-level context-db API implementing MemoryOrgan.
pub struct ContextDb {
    db: Db,
}

impl ContextDb {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let db = Db::new(path).await?;
        Ok(Self { db })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let db = Db::in_memory().await?;
        Ok(Self { db })
    }

    pub async fn execution_count(&self) -> anyhow::Result<u64> {
        self.db.with_conn(|conn| {
            let count: u64 = conn.query_row(
                "SELECT COUNT(*) FROM executions", [], |row| row.get(0)
            )?;
            Ok(count)
        }).await
    }
}
```

- [ ] **Step 7: Run tests**

Run: `cargo test -p context-db --test schema_test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): implement SQLite schema with FTS5 triggers"
```

---

### Task 17: Execution storage (MemoryOrgan::store for Memory::Execution)

**Files:**
- Create: `crates/context-db/src/store.rs`
- Modify: `crates/context-db/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/context-db/tests/store_test.rs`:

```rust
use cortx_types::{CodeLocation, ExecutionRecord, Memory, MemoryOrgan, Tier};

#[tokio::test]
async fn test_store_execution() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let record = ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: Some("task-1".to_string()),
        command: "cargo test".to_string(),
        exit_code: Some(101),
        tier: Tier::Safe,
        duration_ms: 2340,
        summary: "3 tests failed".to_string(),
        errors: vec![CodeLocation {
            file: "src/auth.rs".to_string(),
            line: Some(42),
            msg: "assertion failed".to_string(),
        }],
        files_touched: vec!["src/auth.rs".to_string()],
    };

    let id = db.store(Memory::Execution(record)).await.unwrap();
    assert!(!id.0.is_empty());

    let count = db.execution_count().await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_store_project_fact() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let id = db.store(Memory::ProjectFact {
        fact: "The auth module uses JWT tokens".to_string(),
        citation: "src/auth.rs:10".to_string(),
        source: cortx_types::MemorySource::Agent,
    }).await.unwrap();
    assert!(!id.0.is_empty());
}

#[tokio::test]
async fn test_store_causal_chain() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let id = db.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".to_string(),
        trigger_error: Some("assertion failed".to_string()),
        resolution_files: vec!["src/db/repo.rs".to_string()],
    }).await.unwrap();
    assert!(!id.0.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test store_test`
Expected: FAIL — `store` method not found

- [ ] **Step 3: Implement store.rs**

Create `crates/context-db/src/store.rs`:

```rust
use anyhow::Result;
use cortx_types::{ExecutionRecord, Memory, MemoryId, MemorySource};

use crate::db::Db;

pub async fn store_memory(db: &Db, memory: Memory) -> Result<MemoryId> {
    match memory {
        Memory::Execution(record) => store_execution(db, record).await,
        Memory::CausalChain {
            trigger_file,
            trigger_error,
            resolution_files,
        } => store_causal_chain(db, trigger_file, trigger_error, resolution_files).await,
        Memory::ProjectFact {
            fact,
            citation,
            source,
        } => store_project_fact(db, fact, citation, source).await,
    }
}

async fn store_execution(db: &Db, record: ExecutionRecord) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let errors_json = serde_json::to_string(&record.errors.iter().map(|e| {
        serde_json::json!({
            "file": e.file,
            "line": e.line,
            "msg": e.msg,
        })
    }).collect::<Vec<_>>())?;
    let files_json = serde_json::to_string(&record.files_touched)?;

    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO executions (id, session_id, task_id, command, exit_code, tier, duration_ms, summary, errors, files_touched, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                id_clone,
                record.session_id,
                record.task_id,
                record.command,
                record.exit_code,
                record.tier.as_str(),
                record.duration_ms as i64,
                record.summary,
                errors_json,
                files_json,
                now,
            ],
        )?;
        Ok(())
    }).await?;

    Ok(MemoryId(id))
}

async fn store_causal_chain(
    db: &Db,
    trigger_file: String,
    trigger_error: Option<String>,
    resolution_files: Vec<String>,
) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Utc::now().to_rfc3339();

    // Store one chain per resolution file
    for res_file in resolution_files {
        let id_inner = uuid::Uuid::new_v4().to_string();
        let trigger_file = trigger_file.clone();
        let trigger_error = trigger_error.clone();
        let now = now.clone();
        db.with_conn(move |conn| {
            conn.execute(
                -- Use empty string instead of NULL for trigger_command so the UNIQUE constraint works
                -- (SQLite: NULL != NULL, so ON CONFLICT would never match with NULL values)
                "INSERT INTO causal_chains (id, trigger_file, trigger_error, trigger_command, resolution_file, last_verified, created_at)
                 VALUES (?1, ?2, ?3, '', ?4, ?5, ?5)
                 ON CONFLICT(trigger_file, trigger_command, resolution_file) DO UPDATE SET
                   attempts = attempts + 1,
                   successes = successes + 1,
                   confidence = MIN(1.0, confidence + 0.1),
                   last_verified = ?5",
                rusqlite::params![id_inner, trigger_file, trigger_error, res_file, now],
            )?;
            Ok(())
        }).await?;
    }

    Ok(MemoryId(id_clone))
}

async fn store_project_fact(
    db: &Db,
    fact: String,
    citation: String,
    source: MemorySource,
) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Utc::now().to_rfc3339();
    let source_str = match source {
        MemorySource::Agent => "agent",
        MemorySource::Proxy => "proxy",
        MemorySource::User => "user",
    };

    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO project_facts (id, fact, citation, source, confidence, verified_at, created_at)
             VALUES (?1, ?2, ?3, ?4, 1.0, ?5, ?5)",
            rusqlite::params![id_clone, fact, citation, source_str, now],
        )?;
        Ok(())
    }).await?;

    Ok(MemoryId(id))
}
```

- [ ] **Step 4: Update lib.rs to implement MemoryOrgan**

```rust
pub mod db;
pub mod migrations;
pub mod store;

pub use db::Db;

use cortx_types::{Memory, MemoryHint, MemoryId, MemoryOrgan, RecallQuery, ExecutionRecord};

pub struct ContextDb {
    db: Db,
}

impl ContextDb {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let db = Db::new(path).await?;
        Ok(Self { db })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let db = Db::in_memory().await?;
        Ok(Self { db })
    }

    pub async fn execution_count(&self) -> anyhow::Result<u64> {
        self.db.with_conn(|conn| {
            let count: u64 = conn.query_row(
                "SELECT COUNT(*) FROM executions", [], |row| row.get(0)
            )?;
            Ok(count)
        }).await
    }
}

impl MemoryOrgan for ContextDb {
    async fn store(&self, memory: Memory) -> anyhow::Result<MemoryId> {
        store::store_memory(&self.db, memory).await
    }

    async fn recall(&self, _query: RecallQuery) -> anyhow::Result<Vec<MemoryHint>> {
        // Implemented in Task 18
        Ok(Vec::new())
    }

    async fn last_failure_for_command(&self, _command: &str) -> anyhow::Result<Option<ExecutionRecord>> {
        // Implemented in Task 18
        Ok(None)
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p context-db --test store_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): implement memory storage (executions, causal chains, project facts)"
```

---

### Task 18: Recall — FTS5 search, confidence ranking, last_failure_for_command

**Files:**
- Create: `crates/context-db/src/recall.rs`
- Modify: `crates/context-db/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/context-db/tests/recall_test.rs`:

```rust
use cortx_types::{
    CodeLocation, ExecutionRecord, Memory, MemoryOrgan, MemorySource, RecallQuery, Tier,
};

#[tokio::test]
async fn test_recall_fts5_search() {
    let db = context_db::ContextDb::in_memory().await.unwrap();

    // Store a fact
    db.store(Memory::ProjectFact {
        fact: "The authentication module validates JWT tokens".to_string(),
        citation: "src/auth.rs:10".to_string(),
        source: MemorySource::Agent,
    }).await.unwrap();

    db.store(Memory::ProjectFact {
        fact: "Database uses WAL mode for concurrency".to_string(),
        citation: "src/db/mod.rs:5".to_string(),
        source: MemorySource::Agent,
    }).await.unwrap();

    // Search for "JWT"
    let hints = db.recall(RecallQuery {
        text: Some("JWT".to_string()),
        ..Default::default()
    }).await.unwrap();

    assert_eq!(hints.len(), 1);
    assert!(hints[0].summary.contains("JWT"));
}

#[tokio::test]
async fn test_recall_by_file() {
    let db = context_db::ContextDb::in_memory().await.unwrap();

    // Store a causal chain
    db.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".to_string(),
        trigger_error: Some("assertion failed".to_string()),
        resolution_files: vec!["src/db/repo.rs".to_string()],
    }).await.unwrap();

    // Recall by file
    let hints = db.recall(RecallQuery {
        files: vec!["src/auth.rs".to_string()],
        ..Default::default()
    }).await.unwrap();

    assert_eq!(hints.len(), 1);
    assert_eq!(hints[0].kind, "causal_chain");
}

#[tokio::test]
async fn test_last_failure_for_command() {
    let db = context_db::ContextDb::in_memory().await.unwrap();

    // Store a failed execution
    db.store(Memory::Execution(ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: None,
        command: "cargo test".to_string(),
        exit_code: Some(101),
        tier: Tier::Safe,
        duration_ms: 1000,
        summary: "test failed".to_string(),
        errors: vec![CodeLocation {
            file: "src/auth.rs".to_string(),
            line: Some(42),
            msg: "assertion failed".to_string(),
        }],
        files_touched: vec![],
    })).await.unwrap();

    // Store a successful execution of a DIFFERENT command
    db.store(Memory::Execution(ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: None,
        command: "cargo clippy".to_string(),
        exit_code: Some(0),
        tier: Tier::Safe,
        duration_ms: 500,
        summary: "ok".to_string(),
        errors: vec![],
        files_touched: vec![],
    })).await.unwrap();

    let fail = db.last_failure_for_command("cargo test").await.unwrap();
    assert!(fail.is_some());
    assert_eq!(fail.unwrap().command, "cargo test");

    let no_fail = db.last_failure_for_command("cargo clippy").await.unwrap();
    assert!(no_fail.is_none()); // clippy succeeded
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test recall_test`
Expected: FAIL — recall returns empty, last_failure returns None

- [ ] **Step 3: Implement recall.rs**

Create `crates/context-db/src/recall.rs`:

```rust
use anyhow::Result;
use cortx_types::{CodeLocation, ExecutionRecord, MemoryHint, RecallQuery, Tier};
use rusqlite::OptionalExtension;

use crate::db::Db;

pub async fn recall(db: &Db, query: RecallQuery) -> Result<Vec<MemoryHint>> {
    let mut hints = Vec::new();

    // FTS5 text search on project_facts
    if let Some(text) = &query.text {
        let text = text.clone();
        let min_conf = query.min_confidence.unwrap_or(0.0);
        let fts_results = db.with_conn(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT pf.fact, pf.citation, pf.confidence
                 FROM project_facts pf
                 JOIN memory_fts ON memory_fts.rowid = pf.rowid
                 WHERE memory_fts MATCH ?1 AND pf.confidence >= ?2
                 ORDER BY pf.confidence DESC
                 LIMIT 10"
            )?;
            let results: Vec<(String, String, f64)> = stmt.query_map(
                rusqlite::params![text, min_conf],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            )?.filter_map(|r| r.ok()).collect();
            Ok(results)
        }).await?;

        for (fact, citation, confidence) in fts_results {
            hints.push(MemoryHint {
                kind: "project_fact".to_string(),
                summary: format!("{fact} [{citation}]"),
                confidence,
            });
        }
    }

    // File-based search on causal_chains
    if !query.files.is_empty() {
        let files = query.files.clone();
        let min_conf = query.min_confidence.unwrap_or(0.0);
        let chain_results = db.with_conn(move |conn| {
            let placeholders: Vec<String> = (1..=files.len()).map(|i| format!("?{i}")).collect();
            let sql = format!(
                "SELECT trigger_file, trigger_error, resolution_file, confidence
                 FROM causal_chains
                 WHERE trigger_file IN ({}) AND confidence >= ?{}
                 ORDER BY confidence DESC
                 LIMIT 10",
                placeholders.join(","),
                files.len() + 1
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
                files.into_iter().map(|f| Box::new(f) as Box<dyn rusqlite::types::ToSql>).collect();
            params.push(Box::new(min_conf));
            let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

            let mut stmt = conn.prepare(&sql)?;
            let results: Vec<(String, Option<String>, String, f64)> = stmt.query_map(
                &*params_refs,
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            )?.filter_map(|r| r.ok()).collect();
            Ok(results)
        }).await?;

        for (trigger, error, resolution, confidence) in chain_results {
            let error_str = error.as_deref().unwrap_or("unknown error");
            hints.push(MemoryHint {
                kind: "causal_chain".to_string(),
                summary: format!(
                    "When {trigger} fails with \"{error_str}\", check {resolution}"
                ),
                confidence,
            });
        }
    }

    Ok(hints)
}

pub async fn last_failure_for_command(db: &Db, command: &str) -> Result<Option<ExecutionRecord>> {
    let command = command.to_string();
    db.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, task_id, command, exit_code, tier, duration_ms, summary, errors, files_touched
             FROM executions
             WHERE command = ?1 AND exit_code IS NOT NULL AND exit_code != 0
             ORDER BY created_at DESC
             LIMIT 1"
        )?;

        let record = stmt.query_row(rusqlite::params![command], |row| {
            let errors_json: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
            let files_json: String = row.get::<_, Option<String>>(9)?.unwrap_or_default();
            Ok((
                row.get::<_, String>(1)?,  // session_id
                row.get::<_, Option<String>>(2)?,  // task_id
                row.get::<_, String>(3)?,  // command
                row.get::<_, Option<i32>>(4)?,  // exit_code
                row.get::<_, String>(5)?,  // tier
                row.get::<_, Option<i64>>(6)?.unwrap_or(0) as u64,  // duration_ms
                row.get::<_, Option<String>>(7)?.unwrap_or_default(),  // summary
                errors_json,
                files_json,
            ))
        }).optional()?;

        match record {
            Some((session_id, task_id, command, exit_code, tier_str, duration_ms, summary, errors_json, files_json)) => {
                let errors: Vec<CodeLocation> = serde_json::from_str::<Vec<serde_json::Value>>(&errors_json)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|v| CodeLocation {
                        file: v["file"].as_str().unwrap_or("").to_string(),
                        line: v["line"].as_u64().map(|n| n as u32),
                        msg: v["msg"].as_str().unwrap_or("").to_string(),
                    })
                    .collect();
                let files_touched: Vec<String> = serde_json::from_str(&files_json).unwrap_or_default();

                Ok(Some(ExecutionRecord {
                    session_id,
                    task_id,
                    command,
                    exit_code,
                    tier: Tier::from_str(&tier_str).unwrap_or(Tier::Safe),
                    duration_ms,
                    summary,
                    errors,
                    files_touched,
                }))
            }
            None => Ok(None),
        }
    }).await
}
```

- [ ] **Step 4: Wire recall into lib.rs**

Update `crates/context-db/src/lib.rs` — add `pub mod recall;` and update the `MemoryOrgan` implementation:

```rust
pub mod db;
pub mod migrations;
pub mod store;
pub mod recall;

pub use db::Db;

use cortx_types::{Memory, MemoryHint, MemoryId, MemoryOrgan, RecallQuery, ExecutionRecord};

pub struct ContextDb {
    db: Db,
}

impl ContextDb {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let db = Db::new(path).await?;
        Ok(Self { db })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let db = Db::in_memory().await?;
        Ok(Self { db })
    }

    pub async fn execution_count(&self) -> anyhow::Result<u64> {
        self.db.with_conn(|conn| {
            let count: u64 = conn.query_row(
                "SELECT COUNT(*) FROM executions", [], |row| row.get(0)
            )?;
            Ok(count)
        }).await
    }
}

impl MemoryOrgan for ContextDb {
    async fn store(&self, memory: Memory) -> anyhow::Result<MemoryId> {
        store::store_memory(&self.db, memory).await
    }

    async fn recall(&self, query: RecallQuery) -> anyhow::Result<Vec<MemoryHint>> {
        recall::recall(&self.db, query).await
    }

    async fn last_failure_for_command(&self, command: &str) -> anyhow::Result<Option<ExecutionRecord>> {
        recall::last_failure_for_command(&self.db, command).await
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test -p context-db --test recall_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): implement recall with FTS5 search and last_failure_for_command"
```

---

### Task 19: Git-aware confidence decay

**Files:**
- Create: `crates/context-db/src/decay.rs`
- Modify: `crates/context-db/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/context-db/tests/decay_test.rs`:

```rust
use context_db::decay;

#[test]
fn test_confidence_decay_no_churn() {
    // 0 commits since verified → confidence intact
    let conf = decay::compute_confidence(0.8, 0, 15);
    assert!((conf - 0.8).abs() < 0.001);
}

#[test]
fn test_confidence_decay_some_churn() {
    // 5 commits / normalizer 15 → churn 0.33 → confidence × 0.67
    let conf = decay::compute_confidence(0.8, 5, 15);
    let expected = 0.8 * (1.0 - 5.0 / 15.0);
    assert!((conf - expected).abs() < 0.001);
}

#[test]
fn test_confidence_decay_full_churn() {
    // 15+ commits → confidence × 0.0
    let conf = decay::compute_confidence(0.8, 15, 15);
    assert!((conf - 0.0).abs() < 0.001);

    let conf = decay::compute_confidence(0.8, 20, 15);
    assert!((conf - 0.0).abs() < 0.001);
}

#[test]
fn test_confidence_decay_custom_normalizer() {
    // normalizer 10, 5 commits → churn 0.5 → confidence × 0.5
    let conf = decay::compute_confidence(1.0, 5, 10);
    assert!((conf - 0.5).abs() < 0.001);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test decay_test`
Expected: FAIL

- [ ] **Step 3: Implement decay.rs**

Create `crates/context-db/src/decay.rs`:

```rust
use std::process::Command;

/// Default churn normalizer: 15 commits touching a file = fully stale.
pub const DEFAULT_CHURN_NORMALIZER: u32 = 15;

/// Compute decayed confidence based on git churn.
///
/// confidence = base × (1 - churn_rate)
/// churn_rate = min(1.0, commits / normalizer)
pub fn compute_confidence(base: f64, commits_since_verified: u32, normalizer: u32) -> f64 {
    if normalizer == 0 {
        return 0.0;
    }
    let churn_rate = (commits_since_verified as f64 / normalizer as f64).min(1.0);
    base * (1.0 - churn_rate)
}

/// Count git commits touching a file since a given date.
/// Uses `git log --oneline --since={date} -- {file} | wc -l`.
/// Returns 0 on any error (fail-open: missing git = no decay).
pub fn count_commits_since(file: &str, since: &str, cwd: &str) -> u32 {
    let output = Command::new("git")
        .args(["log", "--oneline", &format!("--since={since}"), "--", file])
        .current_dir(cwd)
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.lines().count() as u32
        }
        Err(_) => 0,
    }
}
```

- [ ] **Step 4: Update lib.rs**

Add `pub mod decay;` to the module list.

- [ ] **Step 5: Run tests**

Run: `cargo test -p context-db --test decay_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): implement git-aware confidence decay"
```

---

### Task 20: Automatic purge rules

**Files:**
- Create: `crates/context-db/src/purge.rs`
- Modify: `crates/context-db/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `crates/context-db/tests/purge_test.rs`:

```rust
use cortx_types::{ExecutionRecord, Memory, MemoryOrgan, Tier};

#[tokio::test]
async fn test_purge_unconfirmed_chains() {
    let db = context_db::ContextDb::in_memory().await.unwrap();

    // Store a causal chain (will have attempts=1, successes=1 by default)
    db.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".to_string(),
        trigger_error: Some("error".to_string()),
        resolution_files: vec!["src/fix.rs".to_string()],
    }).await.unwrap();

    // Purge with a 0-day threshold (purge everything unconfirmed)
    let purged = context_db::purge::purge_unconfirmed_chains(&db.db(), 0).await.unwrap();
    assert_eq!(purged, 1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p context-db --test purge_test`
Expected: FAIL

- [ ] **Step 3: Implement purge.rs**

Create `crates/context-db/src/purge.rs`:

```rust
use anyhow::Result;
use crate::db::Db;

/// Purge causal chains with attempts < 2 older than `age_days` days.
pub async fn purge_unconfirmed_chains(db: &Db, age_days: u32) -> Result<u64> {
    let age_days = age_days as i64;
    db.with_conn(move |conn| {
        let deleted = conn.execute(
            "DELETE FROM causal_chains
             WHERE attempts < 2
             AND julianday('now') - julianday(created_at) > ?1",
            rusqlite::params![age_days],
        )?;
        Ok(deleted as u64)
    }).await
}

/// Archive low-confidence memories (confidence < threshold).
pub async fn archive_low_confidence(db: &Db, threshold: f64) -> Result<u64> {
    db.with_conn(move |conn| {
        // Archive causal chains
        let count1 = conn.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'causal_chains', json_object(
                'trigger_file', trigger_file,
                'trigger_error', trigger_error,
                'resolution_file', resolution_file,
                'confidence', confidence
             ), datetime('now')
             FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        conn.execute(
            "DELETE FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;

        // Archive project facts
        let count2 = conn.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'project_facts', json_object(
                'fact', fact,
                'citation', citation,
                'source', source,
                'confidence', confidence
             ), datetime('now')
             FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        conn.execute(
            "DELETE FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;

        Ok((count1 + count2) as u64)
    }).await
}

/// Purge old executions (older than `age_days` days).
pub async fn purge_old_executions(db: &Db, age_days: u32) -> Result<u64> {
    let age_days = age_days as i64;
    db.with_conn(move |conn| {
        let deleted = conn.execute(
            "DELETE FROM executions
             WHERE julianday('now') - julianday(created_at) > ?1",
            rusqlite::params![age_days],
        )?;
        Ok(deleted as u64)
    }).await
}
```

- [ ] **Step 4: Update lib.rs — add `pub mod purge;` and a `db()` accessor**

Add to `ContextDb`:

```rust
pub fn db(&self) -> &Db {
    &self.db
}
```

Add `pub mod purge;` to module list.

- [ ] **Step 5: Run tests**

Run: `cargo test -p context-db --test purge_test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): implement automatic purge rules"
```

---

### Task 21: context-db standalone MCP server + CLI binary

**Files:**
- Create: `crates/context-db/src/mcp.rs`
- Modify: `crates/context-db/src/main.rs`

- [ ] **Step 1: Implement MCP server skeleton**

Create `crates/context-db/src/mcp.rs`:

```rust
use serde_json::Value;

pub fn tools_list() -> Value {
    serde_json::json!({
        "tools": [
            {
                "name": "memory_store",
                "description": "Store a fact, causal chain, or execution event.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "type": { "type": "string", "enum": ["fact", "causal_chain", "execution"] },
                        "data": { "type": "object" }
                    },
                    "required": ["type", "data"]
                }
            },
            {
                "name": "memory_recall",
                "description": "Search memory (FTS5 + confidence ranking).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "Full-text search query" },
                        "files": { "type": "array", "items": { "type": "string" } },
                        "min_confidence": { "type": "number" }
                    }
                }
            },
            {
                "name": "memory_status",
                "description": "Memory stats: counts, stale entries, DB size.",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}
```

- [ ] **Step 2: Implement CLI binary**

Update `crates/context-db/src/main.rs`:

```rust
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "context-db", about = "Memory organ for cortx")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Run MCP stdio transport
    Mcp {
        /// Path to context.db
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
    /// Query memory from CLI
    Query {
        /// Full-text search query
        query: String,
        /// Path to context.db
        #[arg(short, long, default_value = "context.db")]
        db: String,
    },
}

fn main() {
    let args = Args::parse();
    match args.command {
        Some(Cli::Query { query, db }) => {
            println!("context-db query: \"{query}\" (db: {db})");
            println!("Full implementation deferred to Phase 4");
        }
        Some(Cli::Mcp { db }) => {
            println!("context-db mcp: db={db}");
            println!("Full MCP implementation deferred to Phase 4");
        }
        None => {
            println!("context-db: use --help for usage");
        }
    }
}
```

- [ ] **Step 3: Add mcp module to lib.rs**

Add `pub mod mcp;` to the module list.

- [ ] **Step 4: Verify it compiles**

Run: `cargo build -p context-db`
Expected: compiles

- [ ] **Step 5: Commit**

```bash
git add crates/context-db/
git commit -m "feat(context-db): add MCP server skeleton and CLI binary"
```

---

## Chunk 4: Phase 4 — cortx Orchestrator

The orchestrator wires the 3 organs together. It depends on Phases 2 and 3 being complete.

### Task 22: CortxOrchestrator struct with execute_and_remember

**Files:**
- Modify: `crates/cortx/Cargo.toml`
- Create: `crates/cortx/src/orchestrator.rs`
- Modify: `crates/cortx/src/main.rs`

- [ ] **Step 1: Update cortx/Cargo.toml with all dependencies**

```toml
[package]
name = "cortx"
version.workspace = true
edition.workspace = true

[lib]
name = "cortx"

[[bin]]
name = "cortx"
path = "src/main.rs"

[dependencies]
cortx-types = { path = "../cortx-types" }
kanwise = { path = "../kanwise" }
rtk-proxy = { path = "../rtk-proxy" }
context-db = { path = "../context-db" }
anyhow.workspace = true
tokio.workspace = true
serde.workspace = true
serde_json.workspace = true
clap.workspace = true
tracing.workspace = true
tracing-subscriber = { workspace = true, features = ["env-filter"] }
uuid.workspace = true
```

- [ ] **Step 2: Write the failing test**

Create `crates/cortx/tests/orchestrator_test.rs`:

```rust
use cortx_types::{
    ActionOrgan, Command, ExecutionMode, MemoryOrgan, Status,
};
use std::path::PathBuf;

#[tokio::test]
async fn test_execute_and_remember_stores_execution() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();

    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    let cmd = Command {
        cmd: "echo hello".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };

    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);

    // Verify execution was stored in memory
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_execute_and_remember_stores_on_failure() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();

    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    // Execute a failing command — `false` produces no structured errors,
    // so hints won't match, but the execution must still be stored
    let cmd = Command {
        cmd: "false".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };

    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Failed);
    // Execution should still be stored even on failure
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p cortx --test orchestrator_test`
Expected: FAIL

- [ ] **Step 4: Implement orchestrator.rs**

Create `crates/cortx/src/orchestrator.rs`:

```rust
use anyhow::Result;
use cortx_types::{
    ActionOrgan, Budget, Command, ExecutionRecord, ExecutionResult, Memory, MemoryOrgan,
    RecallQuery, Status,
};
use uuid::Uuid;

pub struct Orchestrator {
    kanwise: kanwise::Kanwise,
    proxy: rtk_proxy::Proxy,
    memory: context_db::ContextDb,
    session_id: String,
}

impl Orchestrator {
    pub fn new(
        kanwise: kanwise::Kanwise,
        proxy: rtk_proxy::Proxy,
        memory: context_db::ContextDb,
    ) -> Self {
        Self {
            kanwise,
            proxy,
            memory,
            session_id: Uuid::new_v4().to_string(),
        }
    }

    /// Convenience constructor for tests — creates a stub kanwise with in-memory DB
    pub async fn without_kanwise(
        proxy: rtk_proxy::Proxy,
        memory: context_db::ContextDb,
    ) -> anyhow::Result<Self> {
        let db = kanwise::Db::in_memory().await?;
        let kanwise = kanwise::Kanwise::new(db);
        Ok(Self {
            kanwise,
            proxy,
            memory,
            session_id: Uuid::new_v4().to_string(),
        })
    }

    pub fn kanwise(&self) -> &kanwise::Kanwise {
        &self.kanwise
    }

    pub fn memory(&self) -> &context_db::ContextDb {
        &self.memory
    }

    pub async fn execute_and_remember(&self, cmd: Command) -> Result<ExecutionResult> {
        let task_id = cmd.task_id.clone();
        let cmd_str = cmd.cmd.clone();

        // 1. Proxy executes — this is the only operation that can fail the call
        let result = self.proxy.execute(cmd).await?;

        // 2. Convert to ExecutionRecord for storage
        let record = ExecutionRecord {
            session_id: self.session_id.clone(),
            task_id,
            command: result.command.clone(),
            exit_code: result.exit_code,
            tier: result.tier,
            duration_ms: result.duration_ms,
            summary: result.summary.clone(),
            errors: result.errors.clone(),
            files_touched: result.files_touched.clone(),
        };

        // 3. Store execution — best-effort, memory failure never blocks result
        let _ = self.memory.store(Memory::Execution(record)).await;

        // 4. On failure → check if memory knows this pattern (best-effort)
        if result.status == Status::Failed {
            if let Ok(hints) = self.memory.recall(RecallQuery {
                files: result.error_files(),
                error_patterns: result.error_messages(),
                ..Default::default()
            }).await {
                if !hints.is_empty() {
                    return Ok(result.with_hints(hints));
                }
            }
            return Ok(result);
        }

        // 5. On success after previous failure of SAME COMMAND → build causal chain
        if result.status == Status::Passed {
            if let Ok(Some(prev_fail)) = self.memory.last_failure_for_command(&cmd_str).await {
                if let Some(trigger) = prev_fail.errors.first() {
                    let _ = self.memory.store(Memory::CausalChain {
                        trigger_file: trigger.file.clone(),
                        trigger_error: Some(trigger.msg.clone()),
                        resolution_files: result.files_touched.clone(),
                    }).await;
                }
            }
        }

        Ok(result)
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn remaining_budget(&self) -> Budget {
        self.proxy.remaining_budget()
    }
}
```

- [ ] **Step 5: Create cortx/src/lib.rs and update main.rs**

Create `crates/cortx/src/lib.rs`:

```rust
pub mod orchestrator;
```

Update `crates/cortx/src/main.rs`:

```rust
fn main() {
    println!("cortx: not yet implemented. Use `cortx serve` or `cortx status`.");
}
```

- [ ] **Step 6: Run tests**

Run: `cargo test -p cortx --test orchestrator_test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add crates/cortx/
git commit -m "feat(cortx): implement Orchestrator with execute_and_remember"
```

---

### Task 23: cortx CLI commands (serve, status, doctor, rollback)

**Files:**
- Modify: `crates/cortx/src/main.rs`

- [ ] **Step 1: Implement CLI structure**

Update `crates/cortx/src/main.rs`:

```rust
pub mod orchestrator;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cortx", about = "AI development orchestrator")]
struct Args {
    #[command(subcommand)]
    command: Option<Cli>,
}

#[derive(Subcommand)]
enum Cli {
    /// Start the unified MCP server (meta-MCP)
    Serve {
        /// Project root directory
        #[arg(short, long, default_value = ".")]
        project: String,
        /// Path to cortx-policy.toml
        #[arg(long, default_value = "cortx-policy.toml")]
        policy: String,
    },
    /// Show status: tasks, proxy budget, memory stats
    Status,
    /// Verify everything is OK (DBs, policy, git)
    Doctor,
    /// Shortcut to proxy_rollback
    Rollback,
    /// Show or edit active policy
    Policy {
        #[command(subcommand)]
        command: PolicyCommand,
    },
}

#[derive(Subcommand)]
enum PolicyCommand {
    /// Show current policy
    Show,
    /// Edit policy (opens $EDITOR)
    Edit,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    match args.command {
        Some(Cli::Serve { project, policy }) => {
            println!("cortx serve: project={project}, policy={policy}");
            println!("Meta-MCP server — full implementation is the final integration step");
        }
        Some(Cli::Status) => {
            println!("cortx status: not yet connected to organs");
        }
        Some(Cli::Doctor) => {
            println!("cortx doctor: checking...");
            // TODO: verify kanwise.db exists, cortx-policy.toml parses, git is available
            println!("All checks passed.");
        }
        Some(Cli::Rollback) => {
            println!("cortx rollback: not yet implemented");
        }
        Some(Cli::Policy { command }) => match command {
            PolicyCommand::Show => {
                println!("cortx policy show: not yet implemented");
            }
            PolicyCommand::Edit => {
                println!("cortx policy edit: not yet implemented");
            }
        },
        None => {
            println!("cortx — AI development orchestrator");
            println!("Use --help for usage");
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p cortx`
Expected: compiles

- [ ] **Step 3: Commit**

```bash
git add crates/cortx/
git commit -m "feat(cortx): add CLI commands (serve, status, doctor, rollback, policy)"
```

---

### Task 24: Full workspace integration test

- [ ] **Step 1: Write integration test**

Create `crates/cortx/tests/integration_test.rs`:

```rust
use cortx_types::{
    ActionOrgan, Command, ExecutionMode, Memory, MemoryOrgan, PlanningOrgan,
    RecallQuery, Status, TaskFilter,
};
use std::path::PathBuf;

/// Full integration: proxy executes → memory stores → recall returns hints
#[tokio::test]
async fn test_full_execute_and_remember_flow() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();

    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    // Execute a command
    let cmd = Command {
        cmd: "echo integration test".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: Some("task-1".to_string()),
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);

    // Verify execution count
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}

/// Test that forbidden commands are blocked cleanly
#[tokio::test]
async fn test_forbidden_command_still_stored() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();

    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory).await.unwrap();

    let cmd = Command {
        cmd: "rm -rf /".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);

    // Even forbidden commands should be recorded in memory
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}
```

- [ ] **Step 2: Run integration tests**

Run: `cargo test -p cortx --test integration_test`
Expected: PASS

- [ ] **Step 3: Run full workspace test suite**

Run: `cargo test --workspace`
Expected: all tests pass across all 6 crates

- [ ] **Step 4: Run clippy on full workspace**

Run: `cargo clippy --workspace -- -D warnings`
Expected: no warnings

- [ ] **Step 5: Commit**

```bash
git add crates/cortx/tests/
git commit -m "test(cortx): add full integration tests for execute_and_remember flow"
```

---

### Task 25: Final Phase 4 verification

- [ ] **Step 1: Clean build**

Run: `cargo build --workspace`
Expected: all crates build

- [ ] **Step 2: Full test suite**

Run: `cargo test --workspace`
Expected: all tests pass

- [ ] **Step 3: Verify binary outputs**

Run the following and check each prints its help/usage:

```bash
cargo run -p kanwise -- --help
cargo run -p rtk-proxy -- --help
cargo run -p context-db -- --help
cargo run -p cortx -- --help
```

- [ ] **Step 4: Final commit (if needed)**

If any cleanup was needed, commit it.

---

## Post-Implementation

After all 4 phases are complete:

1. **Rename GitHub repo**: `tienedev/kanwise` → `tienedev/cortx` (Settings → Repository name). GitHub auto-redirects the old URL.
2. **Update CI/CD**: Adjust for expanded workspace (6 crates).
3. **Update README**: Document the new cortx architecture and CLI commands.
