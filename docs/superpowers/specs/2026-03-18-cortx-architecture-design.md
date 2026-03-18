# Cortx — Architecture Design Spec

**Date:** 2026-03-18
**Status:** Validated
**Scope:** Cortx — a multi-crate AI development orchestrator that uses kanwise as its planning organ

---

## 1. Vision

Cortx is a "central nervous system" for AI-driven development. It orchestrates four independent organs: planning (kanwise), action (rtk-proxy), memory (context-db), and coordination (cortx orchestrator).

Kanwise remains its own independent project and repository (kanban board with MCP, KBF protocol, React frontend, SQLite). Cortx is a **new project** that imports kanwise as a library dependency alongside its own crates. Both projects coexist as separate repos.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Project name | `cortx` | Available on crates.io, GitHub, npm. New repo at `tienedev/cortx`. |
| Repo strategy | Two repos: `kanwise` (unchanged) + `cortx` (new) | Kanwise keeps its identity, star, and independence. Cortx is a separate product. |
| MVP flow | Flux A (MCP assisted) first | Test organs with human in the loop before automating |
| Architecture | Hybrid: lib internally, MCP externally | Speed of Rust calls when orchestrated, independence when standalone |
| Memory approach | Causal chains + git-aware decay | No LLM dependency, proxy produces structured data natively |

### Dependency Chain (no cycles)

```
cortx-types       (in cortx repo, zero dependencies)
     ↑
kanwise           (in kanwise repo, depends on cortx-types via git)
     ↑
cortx             (in cortx repo, depends on kanwise via git)
rtk-proxy         (in cortx repo, depends on cortx-types)
context-db        (in cortx repo, depends on cortx-types)
```

---

## 2. System Overview

### 2.1 Repository Structure

**kanwise repo** (existing — `tienedev/kanwise`):
```
kanwise/
├── crates/
│   ├── server/            # Kanban server (+ lib.rs added for cortx import)
│   └── kbf/               # KBF protocol
├── frontend/              # React UI
└── Cargo.toml             # Adds cortx-types as git dependency
```

**cortx repo** (new — `tienedev/cortx`):
```
cortx/
├── crates/
│   ├── cortx-types/       # Shared traits, common types (no implementation)
│   ├── rtk-proxy/         # Action organ (secure command execution + MCP)
│   ├── context-db/        # Memory organ (SQLite + FTS5 + MCP)
│   └── cortx/             # Orchestrator binary (imports kanwise + organs as lib)
├── policies/              # Default cortx-policy.toml
└── docs/
```

### 2.2 Crate Roles

| Crate | Repo | Type | Role | Own DB |
|---|---|---|---|---|
| `cortx-types` | cortx | lib only | Shared traits, common types | — |
| `kanwise` | kanwise | lib + bin | Kanban: boards, tasks, columns, labels, HTTP/WS, MCP | kanwise.db |
| `kbf` | kanwise | lib only | KBF protocol (unchanged) | — |
| `rtk-proxy` | cortx | lib + bin | Secure command execution, 7-layer pipeline | — (stateless) |
| `context-db` | cortx | lib + bin | Memory: causal chains, git-aware decay, FTS5 | context.db |
| `cortx` | cortx | bin only | Orchestrator: meta-MCP, CLI, future autonomous runner | — |

### 2.3 Communication Model

**Integrated mode** (`cortx serve`): Cortx imports the 3 organs as Rust libraries. Communication is direct function calls (nanoseconds, type-safe).

**Standalone mode**: Each organ runs independently with its own MCP server. No dependency on the others.

```
┌──────────────────────────────────────────────────┐
│  cortx orchestrator                              │
│  ┌─────────────────────────────────────────────┐ │
│  │ MCP Server (unified)                        │ │
│  │ Exposes: board_*, proxy_*, memory_*         │ │
│  └──────┬──────────────┬──────────────┬────────┘ │
│   Rust  │        Rust  │        Rust  │          │
│  ┌──────▼────┐  ┌──────▼──────┐  ┌───▼────────┐ │
│  │  kanwise  │  │  rtk-proxy  │  │ context-db │ │
│  │ (lib mode)│  │ (lib mode)  │  │ (lib mode) │ │
│  │ [SQLite]  │  │ [stateless] │  │ [SQLite]   │ │
│  └───────────┘  └─────────────┘  └────────────┘ │
└──────────────────────────────────────────────────┘
         ▲ MCP (JSON-RPC stdio or SSE)
         │
  Claude Code / Cursor / External MCP client
```

### 2.4 Shared Traits and Types

**Important:** These traits use `async fn` for compile-time contract enforcement only (static dispatch). They are never used as `dyn` trait objects. If dynamic dispatch is needed in the future (e.g., mock organs for testing), use `async-trait` or `trait-variant`.

```rust
// cortx-types/src/lib.rs
use anyhow::Result;
use std::path::PathBuf;

// ── Core types ──

#[derive(Debug, Clone)]
pub struct TaskFilter {
    pub board_id: Option<String>,
    pub label: Option<String>,        // e.g., "ai-ready"
    pub priority_min: Option<Priority>,
}

/// Simplified task view for the orchestrator.
/// Kanwise's internal Task model has more fields (assignee, position, board_id,
/// archived, created_at, updated_at). The PlanningOrgan implementation maps
/// from the full model to this simplified view, joining labels from the
/// task_labels relation table into a flat Vec<String>.
#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub labels: Vec<String>,          // flattened from kanwise label relations
    pub column_id: String,
    pub due_date: Option<String>,
}

/// Mirrors kanwise::db::models::Priority.
/// During Phase 1, kanwise's Priority will be replaced by this one
/// (re-exported from cortx-types) to avoid duplication.
/// Both kbf and kanwise will depend on cortx-types for this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority { Low, Medium, High, Urgent }

#[derive(Debug, Clone)]
pub struct Command {
    pub cmd: String,
    pub cwd: PathBuf,
    pub mode: ExecutionMode,
    pub task_id: Option<String>,      // link to kanwise ticket
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionMode { Assisted, Autonomous, Admin }

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
    pub hints: Vec<MemoryHint>,       // populated by orchestrator
}

#[derive(Debug, Clone)]
pub struct CodeLocation {
    pub file: String,
    pub line: Option<u32>,
    pub msg: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status { Passed, Failed, Timeout, Blocked, Forbidden }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier { Safe, Monitored, Dangerous, Forbidden }

#[derive(Debug, Clone, Default)]
pub struct Budget {
    pub commands_remaining: u32,
    pub cpu_seconds_remaining: u32,
}

/// Record of a single proxy execution, stored in context-db.
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
        citation: String,             // "file:line"
        source: MemorySource,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemorySource { Agent, Proxy, User }

pub struct MemoryId(pub String);

#[derive(Debug, Clone, Default)]
pub struct RecallQuery {
    pub text: Option<String>,         // FTS5 search
    pub files: Vec<String>,           // filter by file references
    pub error_patterns: Vec<String>,  // match against causal chain triggers
    pub min_confidence: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct MemoryHint {
    pub kind: String,                 // "causal_chain" | "project_fact"
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
    /// Find the most recent failed execution of a specific command in the current session.
    /// Used by the orchestrator to build causal chains on success-after-failure.
    async fn last_failure_for_command(&self, command: &str) -> Result<Option<ExecutionRecord>>;
}
```

Cortx depends on traits, not implementations. The compiler enforces the contract. `cortx-types` depends only on `anyhow` — no other external crates.

---

## 3. rtk-proxy — Action Organ

### 3.1 Execution Pipeline (7 layers)

```
Command { cmd, cwd, mode }
  │
  ⓪ AUTH & MODE ─── Admin? → bypass to ⑤
  │                  Assisted / Autonomous → continue
  │
  ① POLICY ENGINE ── Read cortx-policy.toml (global → project → session)
  │                   Match allow/deny patterns → Err(PolicyDenied)
  │
  ② TIER CLASSIFIER
  │   🟢 Safe      → execute freely (cargo test, git status, git diff)
  │   🟡 Monitored → execute + git checkpoint (cargo add, git commit)
  │   🔴 Dangerous → Assisted: human prompt / Autonomous: blocked
  │   ⚫ Forbidden → always rejected (rm -rf, sudo, git push --force)
  │
  ③ BUDGET & RATE LIMITER
  │   Per-session command limit
  │   Loop detection (same command > N times in window)
  │   Cumulative CPU budget
  │
  ④ SANDBOX
  │   cwd locked to project root (no ../ escape)
  │   env filtered (remove *_KEY, *_TOKEN, *_SECRET, *_PASSWORD)
  │   Per-command timeout (default 30s)
  │   Optional: git worktree isolation
  │
  ⑤ EXECUTE (tokio::process::Command)
  │
  ⑥ OUTPUT PROCESSOR
  │   Truncation: keep first N + last N lines if exceeds max
  │   Secret redaction via regex patterns
  │   Structured output → ExecutionResult
  │
  ⑦ AUDIT → Emit ExecutionEvent to context-db (if available)
```

### 3.2 Policy Configuration

```toml
# cortx-policy.toml
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

### 3.3 Admin Mode

Admin mode bypasses layers ①–⑤ but **never bypasses ⑦ (audit trail)**. Every action is traced regardless of mode. Authentication via `CORTX_ADMIN_TOKEN` env var or `cortx-policy.toml`.

### 3.4 Policy Pattern Matching Semantics

Policy patterns use **glob matching against the first command token**, not the full shell string. The proxy tokenizes the command and matches the base command + arguments separately:

- `"cargo test*"` matches `cargo test`, `cargo test -- --nocapture`, `cargo test auth`
- It does **not** match `cargo test && rm -rf /` — the proxy rejects commands containing shell operators (`&&`, `||`, `;`, `|`, backticks) unless they are in the explicit allowlist
- Matching is case-sensitive

### 3.5 ExecutionResult

The `errors` and `warnings` arrays are populated by **best-effort output parsers** specific to known tools (rustc/cargo, npm, eslint). For unknown commands, these arrays may be empty and the raw output is returned in `summary`. Structured parsing is a progressive enhancement, not a guarantee.

```json
{
  "status": "failed",
  "exit_code": 101,
  "duration_ms": 2340,
  "command": "cargo test",
  "tier": "safe",
  "summary": "3 tests failed, 47 passed, 2 ignored",
  "errors": [
    { "file": "src/auth.rs", "line": 42, "msg": "assertion failed: token.is_valid()" },
    { "file": "src/db/repo.rs", "line": 187, "msg": "called unwrap() on Err" }
  ],
  "warnings": [
    { "file": "src/sync/ws.rs", "line": 12, "msg": "unused import: tokio::time" }
  ],
  "truncated": true,
  "budget_remaining": { "commands_remaining": 153, "cpu_seconds_remaining": 255 }
}
```

### 3.6 MCP Tools (standalone)

| Tool | Description |
|---|---|
| `proxy_exec` | Execute a command through the secure pipeline. Returns structured ExecutionResult. |
| `proxy_status` | Remaining budget, execution count, circuit breaker state, last checkpoint. |
| `proxy_rollback` | Restore last git checkpoint (stash pop or worktree discard). |

---

## 4. context-db — Memory Organ

### 4.1 Design Principles

1. **SQLite + FTS5** — proven in kanwise, no external dependency
2. **Zero LLM dependency** — memory extraction is structural (from proxy output), not LLM-based
3. **Passive construction** — context-db observes the proxy and connects the dots
4. **JIT verification** — memories with file citations are verified at read time, not maintained offline
5. **Git-aware staleness** — confidence decays with code churn, not calendar time

### 4.2 Memory Sources

```
rtk-proxy (executions)──┐
                        ├──→ context-db ──→ causal chains
git (commits, diffs)────┤                  → confidence scores
                        │
kanwise (tickets)───────┘
```

The proxy produces structured data at every execution. Context-db stores it directly — no extraction needed. This is the key architectural advantage over systems like Mem0 that require an LLM for every memory operation.

### 4.3 SQLite Schema

**Session definition:** A session starts when an MCP connection opens (or a `cortx auto` run begins) and ends when it closes. The session ID is a UUID generated at connection time. Sessions do not persist across restarts.

```sql
CREATE TABLE executions (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    task_id     TEXT,              -- linked to kanwise ticket (optional)
    command     TEXT NOT NULL,
    exit_code   INTEGER,
    tier        TEXT NOT NULL,     -- safe/monitored/dangerous
    duration_ms INTEGER,
    summary     TEXT,
    errors      TEXT,              -- JSON array of {file, line, msg}
    files_touched TEXT,            -- JSON array, derived from git status diff before/after
    created_at  TEXT NOT NULL
);

CREATE TABLE causal_chains (
    id              TEXT PRIMARY KEY,
    trigger_file    TEXT NOT NULL,
    trigger_error   TEXT,
    trigger_command TEXT,           -- the command that failed (for same-command filtering)
    resolution_file TEXT NOT NULL,
    attempts        INTEGER DEFAULT 1,
    successes       INTEGER DEFAULT 1,
    confidence      REAL DEFAULT 0.5,
    last_verified   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    UNIQUE(trigger_file, trigger_command, resolution_file) -- enables INSERT ON CONFLICT UPDATE for reinforcement
);

CREATE TABLE project_facts (
    id          TEXT PRIMARY KEY,
    fact        TEXT NOT NULL,
    citation    TEXT NOT NULL,      -- "file:line"
    source      TEXT NOT NULL,      -- "agent" | "proxy" | "user"
    confidence  REAL DEFAULT 1.0,
    verified_at TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- Archive table for low-confidence memories
CREATE TABLE archived_memories (
    id            TEXT PRIMARY KEY,
    source_table  TEXT NOT NULL,    -- "causal_chains" | "project_facts"
    data          TEXT NOT NULL,    -- JSON serialized original row
    archived_at   TEXT NOT NULL
);

-- FTS5 with triggers for automatic sync
CREATE VIRTUAL TABLE memory_fts USING fts5(
    fact, citation, content=project_facts, content_rowid=rowid
);

CREATE TRIGGER project_facts_ai AFTER INSERT ON project_facts BEGIN
    INSERT INTO memory_fts(rowid, fact, citation)
    VALUES (new.rowid, new.fact, new.citation);
END;

CREATE TRIGGER project_facts_ad AFTER DELETE ON project_facts BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
    VALUES ('delete', old.rowid, old.fact, old.citation);
END;

CREATE TRIGGER project_facts_au AFTER UPDATE ON project_facts BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
    VALUES ('delete', old.rowid, old.fact, old.citation);
    INSERT INTO memory_fts(rowid, fact, citation)
    VALUES (new.rowid, new.fact, new.citation);
END;
```

**`files_touched` sourcing:** Before execution, the proxy snapshots `git status --porcelain`. After execution, it diffs against the new status. The delta = files touched by the command.

### 4.4 Causal Chain Construction

```
Step 1: Proxy emits events
  exec #1: cargo test → fail → errors: [{file: "auth.rs", line: 42}]
  exec #2: cargo test → fail → errors: [{file: "auth.rs", line: 42}]
  exec #3: cargo test → pass

Step 2: context-db detects the pattern
  Conditions for causal chain creation:
  - exec #3 is the SAME COMMAND as exec #1 (both "cargo test")
  - exec #1 and #3 share at least one common error file
  - Between exec #1 (fail) and exec #3 (pass), which files were modified?
  → Uses `git diff --name-only` (working tree) to capture uncommitted changes
  → If working tree is clean, falls back to `git log --name-only` for committed changes
  → "db/repo.rs" was modified
  → Trigger was "auth.rs" (error), resolution was "db/repo.rs" (edit)

Step 3: Causal chain created
  { trigger: "auth.rs", command: "cargo test", error: "assertion failed",
    resolution: "db/repo.rs", confidence: 0.5 }

Step 4: Reinforcement
  Same command + same trigger file pattern succeeds again → confidence rises
  Same pattern fails → confidence drops
```

**Same-command filtering:** Causal chains are only created when the succeeding command matches the failing command. This prevents spurious correlations (e.g., `cargo test` fails, then `cargo fmt` succeeds — no chain created).

### 4.5 Git-Aware Confidence Decay

```
confidence = base_confidence × (1 - churn_rate)

churn_rate = min(1.0, commits_touching_file_since_verified / CHURN_NORMALIZER)

CHURN_NORMALIZER = 15  (configurable)
  → 0 commits  = churn 0.0  → confidence intact
  → 5 commits  = churn 0.33 → confidence × 0.67
  → 12 commits = churn 0.8  → confidence × 0.2
  → 15+ commits = churn 1.0 → confidence × 0.0 (fully stale)

When confidence < 0.3 → marked "stale" → JIT verification on next recall
When confidence < 0.1 → archived (moved to archived_memories table)
```

Churn is computed **lazily** at recall time — `git log --since={verified_at} -- {file} | wc -l` — not via cron. The normalizer of 15 means "if a file has been touched by 15+ commits since we last verified this memory, we consider it fully stale." This can be tuned per-project in `cortx-policy.toml`.

### 4.6 Automatic Purge

| Rule | Action |
|---|---|
| `confidence < 0.1` | Archived (moved to `archived_memories`) |
| `executions > 90 days` | Aggregated (keep stats, drop details) |
| `DB > 100 MB` | Purge oldest executions first |
| `causal_chain.attempts < 2 AND age > 60 days` | Deleted (never-confirmed pattern) |

### 4.7 MCP Tools (standalone)

| Tool | Description |
|---|---|
| `memory_store` | Store a fact, causal chain, or execution event. |
| `memory_recall` | Search memory (FTS5 + confidence ranking). Returns relevant memories with scores. |
| `memory_status` | Stats: memory count, stale count, causal chain count, DB size. |

### 4.8 Future: Inverse Memory (v2)

Explicitly store failed attempts and their reasons to prevent the agent from repeating dead approaches. Infrastructure is the same as causal chains with an added `resolved: bool` field. Not in MVP scope.

---

## 5. kanwise — Planning Organ (Refactoring)

### 5.1 Changes

**90% of code stays untouched.** The refactoring is structural:

1. **Rename** `crates/server` → `crates/kanwise`
2. **Add `lib.rs`** — expose public modules + implement `PlanningOrgan` trait
3. **Split lib/bin** — library for cortx import, binary for standalone use

```toml
# crates/kanwise/Cargo.toml
[lib]
name = "kanwise"

[[bin]]
name = "kanwise"
path = "src/main.rs"
```

```rust
// crates/kanwise/src/lib.rs (NEW)
pub mod api;
pub mod db;
pub mod mcp;
pub mod auth;
pub mod sync;
pub mod background;
pub mod notifications;
mod static_files;  // private — only needed by the binary

/// Full server mode: HTTP + WS + MCP + background tasks + notifications.
/// Used by `kanwise serve` binary.
pub struct KanwiseServer {
    pub db: db::Db,
    pub notif_tx: notifications::NotifTx,
    // ... other server-specific state
}

/// Lightweight mode: direct DB access for planning operations only.
/// Used by cortx orchestrator (lib import). No HTTP, no WS, no background tasks.
pub struct Kanwise {
    db: db::Db,
}

impl cortx_types::PlanningOrgan for Kanwise {
    async fn get_next_task(&self, filter: TaskFilter) -> Result<Task> {
        // Filter by label "ai-ready", sort by priority then deadline
    }
    async fn complete_task(&self, id: &str) -> Result<()> {
        // Move task to done column + log activity
    }
    async fn list_tasks(&self, board_id: &str) -> Result<Vec<Task>> {
        // Reuses existing repo.rs methods
    }
}
```

**Two structs, two modes:** `KanwiseServer` is the full server with notifications, WebSocket sync, background tasks — used by the standalone binary. `Kanwise` is a thin wrapper around the DB for planning operations only — used by cortx. Both share the same `db::Db` and `db::repo` code.

### 5.2 What Does NOT Change

| Module | Change |
|---|---|
| `db/repo.rs` (3127 lines) | None — PlanningOrgan delegates to existing methods |
| `db/migrations.rs` (8 migrations) | None |
| `api/*` (REST endpoints) | None |
| `mcp/tools.rs` (board_query, board_mutate, board_sync, board_ask) | None |
| `auth/*` | None |
| `sync/*` (Yjs/WS) | None |
| `frontend/` | None |
| `kbf/` | None |

### 5.3 Task Selection with Labels

Kanwise already has labels. Use a label `ai-ready` rather than inventing a new mechanism:

```rust
async fn get_next_task(&self, filter: TaskFilter) -> Result<Task> {
    // 1. Find tasks with label "ai-ready"
    // 2. Sort by priority (urgent > high > medium > low)
    // 3. Then by deadline (closest first)
    // 4. Return first match
}
```

### 5.4 CLI Commands (unchanged)

```
kanwise serve          # HTTP + WS + frontend
kanwise mcp            # MCP stdio
kanwise backup         # Atomic SQLite backup
kanwise restore        # Restore from backup
kanwise export         # Export board to JSON
kanwise import         # Import from JSON
kanwise users list     # List registered users
kanwise reset-password # Reset user password
```

---

## 6. cortx — Orchestrator

### 6.1 Role

Cortx is a **binary whose logic is composition, not domain**. It imports the 3 organs as libraries and wires them together. The proxy→memory wiring (execute_and_remember) is cortx's core intelligence — it is composition logic, not domain logic.

```rust
struct CortxOrchestrator {
    kanwise: kanwise::Kanwise,       // PlanningOrgan
    proxy: rtk_proxy::Proxy,         // ActionOrgan
    memory: context_db::ContextDb,   // MemoryOrgan
}
```

### 6.2 CLI Commands

```
cortx serve              # Meta-MCP: exposes all tools from 3 organs
cortx status             # Text dashboard: tasks, proxy budget, memory stats
cortx rollback           # Shortcut to proxy_rollback
cortx policy [show|edit] # Show/edit active policy
cortx doctor             # Verify everything is OK (DBs, policy, git)

# Future (Flux B)
cortx auto               # Autonomous loop
cortx auto --dry-run     # Simulate without executing
```

### 6.3 Meta-MCP (`cortx serve`)

Startup sequence:
1. Open `kanwise.db` → initialize kanwise organ
2. Load `cortx-policy.toml` → initialize proxy
3. Open `context.db` → initialize memory
4. Wire proxy → memory (proxy emits, memory listens)
5. Start unified MCP server

Exposed tools:
```
board_query          (delegated to kanwise)
board_mutate         (delegated to kanwise)
board_sync           (delegated to kanwise)
board_ask            (delegated to kanwise)
proxy_exec           (delegated to rtk-proxy)
proxy_status         (delegated to rtk-proxy)
proxy_rollback       (delegated to rtk-proxy)
memory_store         (delegated to context-db)
memory_recall        (delegated to context-db)
memory_status        (delegated to context-db)
```

User config:
```json
{
  "mcpServers": {
    "cortx": { "command": "cortx serve --project /path/to/project" }
  }
}
```

### 6.4 The Proxy → Memory Wiring

This is cortx's core value. The proxy alone can't store. Memory alone can't observe. Cortx connects them.

```rust
impl CortxOrchestrator {
    async fn execute_and_remember(&self, cmd: Command) -> Result<ExecutionResult> {
        // 1. Proxy executes
        let result = self.proxy.execute(cmd).await?;

        // 2. Store execution in memory
        self.memory.store(Memory::Execution(result.clone())).await?;

        // 3. On failure → check if memory knows this pattern
        if result.status == Status::Failed {
            let hints = self.memory.recall(RecallQuery {
                files: result.error_files(),
                error_patterns: result.error_messages(),
            }).await?;
            return Ok(result.with_hints(hints));
        }

        // 4. On success after previous failure of SAME COMMAND → build causal chain
        if let Some(prev_fail) = self.memory.last_failure_for_command(
            &result.command, // same-command filter prevents spurious correlations
        )? {
            let modified = git_diff_files(prev_fail.timestamp, result.timestamp)?;
            self.memory.store(Memory::CausalChain {
                trigger_file: prev_fail.error_files().first().unwrap().clone(),
                trigger_error: prev_fail.errors.first().map(|e| e.msg.clone()),
                resolution_files: modified,
            }).await?;
        }

        Ok(result)
    }
}
```

### 6.5 Future: Autonomous Loop (Flux B — not in MVP)

```
cortx auto
  1. kanwise.get_next_task(label: "ai-ready")
  2. Forge prompt with: ticket + memory context + tool list
  3. Send to Anthropic API (reqwest)
  4. While loop:
     - API requests proxy_exec? → execute_and_remember()
     - API requests memory_recall? → recall()
     - API says "done"? → kanwise.complete_task()
  5. git commit + move to next ticket
```

The proxy's security layers (budget, tiers, circuit breaker) protect this loop naturally.

---

## 7. Implementation Path

### Principle: Two repos, incremental, never big bang

Kanwise stays untouched until Phase 1b. Cortx is built from scratch in its own repo. Each phase produces a working system.

### Phase 1a — Create cortx repo (risk: low)

New repo, no impact on kanwise.

1. Create `tienedev/cortx` GitHub repo
2. Initialize Cargo workspace with crates: `cortx-types`, `rtk-proxy`, `context-db`, `cortx`
3. Implement `cortx-types` (all shared traits and types from Section 2.4)
4. Verify workspace compiles

**Result:** cortx repo exists with type definitions. Kanwise untouched.

### Phase 1b — Prepare kanwise for cortx integration (risk: low)

Minimal changes to the kanwise repo.

1. Add `cortx-types` as a git dependency: `cortx-types = { git = "https://github.com/tienedev/cortx" }`
2. Add `lib.rs` to `crates/server/` (with both `KanwiseServer` and `Kanwise` structs)
3. Expose public modules (`api`, `db`, `mcp`, `auth`, `sync`, `background`, `notifications`)
4. Implement `PlanningOrgan` trait on `Kanwise` struct
5. Verify everything compiles + existing tests pass

**Result:** Kanwise is importable as a library. All existing functionality unchanged.

### Phase 2 — rtk-proxy (risk: low)

Entirely in cortx repo. Does not touch kanwise.

1. Policy engine (parse cortx-policy.toml, allow/deny matching)
2. Tier classifier (safe/monitored/dangerous/forbidden + tests)
3. Sandbox (cwd lock, env filter, timeout)
4. Output processor (truncation, secret redaction, structured parsing)
5. Budget & rate limiter + circuit breaker
6. MCP standalone (`rtk-proxy mcp`)
7. Admin mode

**Result:** rtk-proxy usable standalone via MCP.

### Phase 3 — context-db (risk: medium)

Entirely in cortx repo. Does not touch kanwise.

1. SQLite schema + migrations (executions, causal_chains, project_facts, archived_memories, FTS5 + triggers)
2. Execution storage (`MemoryOrgan::store` for `Memory::Execution`)
3. Basic recall (FTS5 search, confidence ranking)
4. Causal chain builder (fail→edit→pass detection, git diff)
5. Git-aware confidence decay (lazy churn computation)
6. Automatic purge (archive, aggregate, size limit)
7. MCP standalone (`context-db mcp`)

**Result:** context-db usable standalone via MCP.

### Phase 4 — cortx orchestrator (risk: low)

In cortx repo. Depends on kanwise via git.

1. Add kanwise as git dependency: `kanwise = { git = "https://github.com/tienedev/kanwise" }`
2. `cortx serve` — meta-MCP, import 3 organs as lib
3. `execute_and_remember()` wiring (proxy→memory, hints, causal chains)
4. `cortx status`, `cortx doctor`, `cortx rollback`
5. End-to-end integration tests

**Result:** cortx MVP complete (Flux A).

### Dependencies

```
Phase 1a (cortx repo + types)
   │
   └──→ Phase 1b (kanwise lib.rs)
           │
           ├──→ Phase 2 (rtk-proxy)     ← independent, cortx repo only
           │
           ├──→ Phase 3 (context-db)    ← independent, cortx repo only
           │
           └──→ Phase 4 (cortx)         ← depends on 1b + 2 + 3
```

Phases 2 and 3 are parallelizable. Both live entirely in the cortx repo.

### Surface Estimation

| Phase | Repo | New Rust lines (est.) | Kanwise files modified |
|---|---|---|---|
| Phase 1a | cortx | ~300 (types + workspace) | 0 |
| Phase 1b | kanwise | ~150 (lib.rs + trait impl) | 2-3 (Cargo.toml, new lib.rs) |
| Phase 2 | cortx | ~1500-2000 | 0 |
| Phase 3 | cortx | ~1200-1500 | 0 |
| Phase 4 | cortx | ~500-800 | 0 |

**Total: ~3700-4750 new lines of Rust.** Kanwise existing code (~12,000 lines) stays intact. Only ~150 lines added to kanwise repo (lib.rs + Cargo.toml dep).

### What Does NOT Change in Kanwise

| Component | Impact |
|---|---|
| React frontend | Zero. Still talks to `kanwise serve`. |
| REST API | Zero. Same routes, same handlers. |
| Existing MCP tools | Zero. board_query/mutate/sync/ask identical. |
| kanwise.db | Zero. Same tables, same migrations. |
| KBF protocol | Zero. |
| kanwise repo name/URL | Zero. Stays `tienedev/kanwise`. |
| kanwise CI/CD | Minimal — add cortx-types dependency. |

---

## 8. Testing Strategy

### rtk-proxy (security-critical — highest test priority)

- **Unit tests:** Tier classification, policy pattern matching, env filtering, secret redaction regex, budget enforcement, loop detection, circuit breaker state machine
- **Integration tests:** End-to-end command execution through the full pipeline with a real `cortx-policy.toml`

### context-db

- **Unit tests:** Memory store/recall, confidence decay calculation, purge rules
- **Integration tests:** Causal chain builder with a real git repo (create a temp repo, make commits, run the detection algorithm, verify chains). FTS5 trigger synchronization.

### cortx orchestrator

- **Integration tests:** Full `execute_and_remember` flow — execute commands via proxy, verify memory was stored, verify hints are returned on subsequent failures, verify causal chains are created on success-after-failure

### kanwise

- **Existing tests remain.** Add unit tests for `PlanningOrgan` trait implementation (get_next_task filtering by label/priority/deadline).

---

## 9. Research Context

Memory system design informed by analysis of current landscape (March 2026):

- **Mem0** (50k ★) — LLM-dependent memory extraction. Not suitable: cortx proxy produces structured data natively.
- **GitHub Copilot Memory** — JIT verification insight adopted: verify at read time, not maintenance time.
- **OpenMemory** (3.7k ★) — Temporal layer concept (valid_from/valid_to) influenced git-aware decay design.
- **MemOS** (7.4k ★) — Tool memory concept confirmed: agent learns which tools work for which problems.
- **Letta Code** (#1 Terminal-Bench) — Skills-as-markdown concept noted for future consideration.

Cortx's unique advantage: it controls all 4 dimensions of the development cycle simultaneously (intent via kanwise, action via proxy, mutation via git, validation via tests). No existing system crosses these 4 signals.
