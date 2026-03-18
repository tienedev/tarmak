# Cortx AI-Native Evolution — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Author:** tiene + Claude

## Overview

Cortx is an AI-native development orchestrator. This spec defines three phases that transform it from a kanban + execution + memory toolkit into a self-improving autonomous development environment.

The core thesis: **the combination of planning (kanwise), secure execution (rtk-proxy), and persistent memory (context-db) enables capabilities no other tool offers.** This spec describes how to activate that potential.

### Target

- Product ambition: open-source, category-creating dev environment
- Business model: open-source + consulting/support
- Users: developers who use LLM-based coding agents and want orchestration, autonomy, and intelligence on top

### Wow Moment

> "I can have agents working simultaneously on my board, advancing the project without my intervention, without conflicts, while saving my tokens and optimizing memory?"

### Phases

| Phase | Name | Focus |
|-------|------|-------|
| **B** | The Learning Machine | Persistent memory that makes agents smarter over time |
| **C** | The Autonomous Pipeline | Objective → delivery loop with quality gates |
| **A** | The Swarm Protocol | N independent agent instances coordinating (future) |

Order: **B → C → A**. Each layer depends on the previous one being solid.

---

## Phase B — The Learning Machine

### B1: Pre-flight & Post-flight Memory Check

#### Problem

Today, `memory_recall` is a manual MCP tool. Agents must explicitly call it. Most don't, or call it too late (after failing). The intelligence in context-db is passive.

#### Solution

Make memory **active**. The orchestrator's `execute_and_remember()` automatically consults memory before and after every qualifying execution.

#### Pre-flight Flow

```
Agent calls: proxy_exec("cargo test")
        │
        ▼
┌─ PRE-FLIGHT ────────────────────────────┐
│ 1. Check tier: Safe commands → skip     │
│ 2. Check history: command never failed  │
│    in this project → skip               │
│ 3. FTS5 recall by:                      │
│    - Files likely to be touched         │
│    - Error patterns from past failures  │
│    - Similar command history            │
│ 4. Filter: confidence >= 0.5 only      │
│ 5. Inject hints into execution result   │
│    (compact format, ~50-100 tokens)     │
└──────────────────────────────────────────┘
        │
        ▼
   Execute (7-layer pipeline)
        │
        ▼
┌─ POST-FLIGHT ───────────────────────────┐
│ If FAIL:                                │
│   → Search for known fixes              │
│   → Return hints with error             │
│ If PASS after previous FAIL:            │
│   → Create causal chain automatically   │
│ If PASS:                                │
│   → Reinforce confidence of used hints  │
└──────────────────────────────────────────┘
```

#### Pre-flight Trigger Rules

| Condition | Pre-flight? | Rationale |
|-----------|------------|-----------|
| Tier = Safe (`git status`, `cat`, `ls`) | No | Near-zero failure risk |
| Tier = Monitored/Dangerous | Yes | Meaningful failure risk |
| Command has failed before in session | Yes, priority | Direct relevance |
| FTS5 query returns 0 results | No injection | Query is cheap (SQLite), zero token cost |

#### Hint Format (compact)

```
⚡ 2 hints from memory:
- [0.87] Last time `cargo test` failed on auth.rs → fixed by updating token validation in middleware.rs
- [0.64] Similar error seen: "connection refused" → check if DB migration ran
```

Confidence score lets the agent prioritize without reading full context. Token cost: ~50-100 tokens per hint, only when relevant.

#### Token Economics

Without pre-flight (typical fail-debug-retry cycle):
```
cargo test → FAIL            200 tokens (output)
Agent reasons                500 tokens
Attempts fix                 300 tokens
cargo test → FAIL again      200 tokens
Agent re-reasons             500 tokens
Second fix attempt           300 tokens
cargo test → PASS
                    Total: ~2000 tokens
```

With pre-flight:
```
cargo test
  └─ hint: [0.87] "this pattern → fix middleware.rs L42"
Agent applies fix            300 tokens
cargo test → PASS
                    Total: ~400 tokens
```

**Net savings: ~1600 tokens per avoided retry cycle.**

#### Relationship to Existing Code

The current `execute_and_remember()` already implements parts of post-flight:
- On failure: recall by `error_files()` and `error_messages()`, attach hints (lines 79-93)
- On pass-after-fail: create causal chain automatically (lines 96-110)

B1 **enriches** the existing flow, it does not replace it:
- **New**: Pre-flight recall (before execution)
- **New**: Confidence reinforcement on success (post-flight addition)
- **Existing**: Failure recall and causal chain creation remain, integrated into the enriched flow

#### Pre-flight Tier Access

The orchestrator needs to classify a command's tier **before** delegating to `Proxy::execute()`. Today, classification happens inside the proxy. Required API addition:

- **`crates/rtk-proxy/src/proxy.rs`**: Expose `pub fn classify(&self, cmd: &str) -> Tier` as a public method (delegates to `self.policy.classify()`)
- The orchestrator calls `self.proxy.classify(&cmd.cmd)` to decide whether to run pre-flight

#### Implementation Changes

- **`crates/rtk-proxy/src/proxy.rs`**: Add public `classify()` method
- **`crates/cortx/src/orchestrator.rs`**: Enrich `execute_and_remember()` with pre-flight recall (using `classify()` to skip Safe commands) and post-flight reinforcement
- **`crates/context-db/src/recall.rs`**: Add `recall_for_preflight(command, files) -> Vec<MemoryHint>` — optimized query combining FTS5 + file match + error pattern
- **`crates/cortx-types/src/lib.rs`**: Extend existing `MemoryHint` with `source: MemorySource` field (reuse existing `MemorySource` enum: Agent/Proxy/User)
- **`ExecutionResult`**: The existing `hints: Vec<MemoryHint>` field is reused for both pre-flight and post-flight hints. Pre-flight hints are populated before execution; post-flight hints are appended after failure. No new field needed.

---

### B2: Confidence Reinforcement

#### Problem

Today, confidence only decays (git churn-based). A valid pattern learned 200 commits ago decays to ~0 even if it's still correct. This is overly pessimistic.

#### Solution

Bidirectional confidence: it goes up on success, down on churn and failure.

```
Confidence
  1.0 ┤         ╭──╮          ╭───── reused successfully
      │        ╱    ╲        ╱
  0.7 ┤───────╱      ╲──────╱
      │  ╱                         natural decay (churn)
  0.3 ┤╱
      │
  0.0 ┤─────────────────────────────────────────── time
       created  success  churn   success
```

#### Rules

| Event | Confidence change |
|-------|------------------|
| Hint used, command succeeds | +0.15 (cap at 1.0) |
| Natural git churn on related files | Decay per existing formula |
| Hint used, command still fails | -0.20 |
| Chain not used for 30+ days, confidence < 0.1 | Eligible for pruning |

#### "Hint Used" Heuristic

We cannot know if the agent read a hint. But we can correlate:
1. Pre-flight returns hint about `auth.rs`
2. Agent touches `auth.rs` within the next 5 commands in the session
3. Original command passes → hint probably helped

This is a heuristic, not certainty. Sufficient for reinforcement.

#### Session State for Hint Tracking

The orchestrator needs a session-scoped data structure to track served hints:

```rust
struct ServedHint {
    chain_id: String,         // matches causal_chains.id (TEXT PK)
    target_files: Vec<String>,
    served_at_command: u32,   // command counter in session
}

// In Orchestrator:
served_hints: Vec<ServedHint>,  // in-memory, lost on restart (acceptable)
command_counter: u32,
```

**Correlation window**: N = 5 commands. After each execution, check if any `served_hints` from the last 5 commands have `target_files` overlapping with `files_touched`. If yes + command passed → reinforce.

This state is ephemeral (in-memory). It doesn't need persistence — reinforcement only happens during active sessions.

#### Interaction with Existing `+0.1` on Store

The existing `store_causal_chain` applies `+0.1` on `ON CONFLICT` (re-store of same chain). The new reinforcement applies `+0.15` when a hint is correlated with success. These are **separate signals**:

- `+0.1` on re-store: "this pattern was observed again" (passive)
- `+0.15` on hint correlation: "this hint actively helped an agent" (active, higher signal)

They can stack. Combined `+0.25` is acceptable — it means the pattern was both re-observed and actively useful. Cap at 1.0 prevents runaway.

#### Implementation Changes

- **`crates/context-db/src/db.rs`**: Add `reinforce_confidence(chain_id, delta: f64)` method
- **`crates/context-db/src/decay.rs`**: Rename to `confidence.rs`, add reinforcement logic alongside decay
- **`crates/cortx/src/orchestrator.rs`**: Add `served_hints: Vec<ServedHint>` and `command_counter: u32` fields, correlate after each execution

---

### B3: Memory Compaction

#### Problem

Over time, the database grows. Duplicate chains, stale data, verbose execution logs.

#### Solution

Background compaction job with three strategies:

| Strategy | Mechanism | Trigger |
|----------|-----------|---------|
| **Merge** | 2 causal chains with same `trigger_error` + same `resolution_files` → merge, keep highest confidence | On store (dedup check) |
| **Prune** | Confidence < 0.1 for > 30 days → delete | On session start |
| **Summarize** | > 50 executions of same command → keep last 10 + create summary row | On session start |

All compaction runs **on session start** (non-blocking). No cron-like scheduler needed — aligns with the existing architecture where sessions are the natural lifecycle unit.

#### Summarize Strategy — Schema Detail

Execution summaries go into a new `execution_summaries` table:

```sql
CREATE TABLE execution_summaries (
    id INTEGER PRIMARY KEY,
    command TEXT NOT NULL,
    total_runs INTEGER NOT NULL,
    success_rate REAL NOT NULL,
    avg_duration_ms INTEGER NOT NULL,
    last_error TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
);
```

When compacting: keep the **last 10 individual executions** per command (so `last_failure_for_command` still works), summarize the rest into `execution_summaries`, then delete the old rows. This preserves recent detail while compressing history.

#### Implementation Changes

- **`crates/context-db/src/compact.rs`**: New module with `merge_duplicates()`, `prune_stale()`, `summarize_executions()`
- **`crates/context-db/src/migrations.rs`**: Add `execution_summaries` and `session_reports` tables using `CREATE TABLE IF NOT EXISTS` (context-db has no versioned migrations yet — acceptable since no production data exists. Versioned migrations can be adopted later if needed.)
- **`crates/context-db/src/db.rs`**: Add `run_compaction()` entry point
- **`crates/cortx/src/orchestrator.rs`**: Call `run_compaction()` on session start (non-blocking, best-effort)

---

## Phase C — The Autonomous Pipeline

### C1: Planning Decompose

#### New MCP Tool: `planning_decompose`

```
planning_decompose(objective, board_id, tasks)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `objective` | String | Free text: "add OAuth Google authentication" |
| `board_id` | String | Target board for task creation |
| `tasks` | Array | Ordered list of tasks: `{ title, description, priority, depends_on: Vec<usize> }` where `depends_on` references array indices |

The agent decides decomposition granularity. Cortx validates and persists.

#### Behavior

1. Receive objective + pre-decomposed tasks from the agent
2. Validate tasks (required fields, dependency graph is acyclic)
3. Create tasks on the board with:
   - Title and description (from agent)
   - Priority (from agent)
   - Label: `ai-ready` (auto-applied)
   - Ordering: dependency-aware (from agent's dependency declarations)
4. Auto-create required labels (`ai-ready`, `needs-human`, etc.) if they don't exist on the board
5. Return the created task list in KBF format (token-efficient)

#### Note on Decomposition

The decomposition itself requires LLM reasoning. Cortx does NOT embed an LLM — the agent calling `planning_decompose` provides the intelligence. The tool provides:
- Validation (are tasks well-formed? is the dependency graph acyclic?)
- Label bootstrapping (auto-create `ai-ready`, `in-progress`, `needs-human`, `ai-done` on first use)
- Board integration (batch-create tasks, set labels, ordering)

The agent sends the decomposed tasks via the tool; cortx validates and persists them.

---

### C2: Execute-Test-Commit Loop

#### The Autonomous Work Cycle

```
planning_next_task (or planning_claim_task)
        │
        ▼
  Create branch: cortx/<agent-id>/<task-id>-<slug>
        │
        ▼
  ┌─ WORK LOOP (max 3 retries) ─────────────┐
  │  proxy_exec: implement changes            │
  │  proxy_exec: run tests                    │
  │       │                                   │
  │  PASS? ──yes──→ Quality gates             │
  │       │              │                    │
  │       no        All pass? ──yes──→ Commit │
  │       │              │                    │
  │       ▼              no                   │
  │  memory_recall       │                    │
  │  (hints for fix)     ▼                    │
  │       │         Fix gate issue            │
  │       ▼              │                    │
  │  Retry ──────────────┘                    │
  └───────────────────────────────────────────┘
        │
   3 retries exhausted?
        │
   yes: escalate (label "needs-human")
   no:  complete_task + comment summary
        │
        ▼
   Next task
```

#### Who Drives the Loop?

The loop is **agent-driven, not cortx-driven**. Cortx provides the MCP tools; the agent orchestrates the cycle. This aligns with the non-goal: "Cortx does NOT spawn agents."

The agent (Claude Code) is responsible for:
- Calling `planning_claim_task` to get work
- Creating the branch (via `proxy_exec("git checkout -b ...")`)
- Implementing, testing, committing
- Calling `planning_complete_task` or escalating

Cortx is responsible for:
- Atomic task claiming (no conflicts)
- Pre-flight/post-flight memory (automatic in `proxy_exec`)
- Quality gate validation (new tool, see below)
- Commenting on tickets (via orchestrator)

#### New MCP Tool: `planning_validate_gates`

```
planning_validate_gates(task_id, branch)
```

Checks quality gates for a task's work branch. Returns pass/fail per gate. The agent calls this before `complete_task`. Configurable via `cortx-gates.toml` (follows the policy TOML pattern from rtk-proxy):

```toml
[gates]
tests = "cargo test --workspace"
lint = "cargo clippy --workspace -- -D warnings"
max_diff_lines = 500

[gates.optional]
format = "cargo fmt --check"
```

#### Quality Gates

Before `complete_task`, the agent calls `planning_validate_gates`:

| Gate | Check | Failure action |
|------|-------|---------------|
| Tests pass | `cargo test` / `npm test` exit 0 | Retry with hints |
| No warnings | `cargo clippy` / `eslint` clean | Fix warnings |
| Commit created | Git commit exists on branch | Create commit |
| Diff reasonable | < configured max lines | Flag for human review |

---

### C3: Agent Comments Protocol

#### When Agents Comment on Tickets

| Event | Comment? | Content |
|-------|----------|---------|
| Bug encountered | Yes | Description, stack trace summary, what was tried |
| Initiative taken | Yes | "Refactored X because Y" — when deviating from plan |
| Architectural decision | Yes | "Chose approach X over Y because..." |
| Dependency added | Yes | "Added `serde_json` for JSON parsing" |
| Rollback performed | Yes | "Checkpoint restored after failure of..." |
| Task completed | Yes | Diff summary, files touched, tests passed |
| Escalation | Yes | What blocks, what was tried, suggested resolution |
| Task started | **No** | Anti-spam: don't comment for routine status |
| Everything going fine | **No** | Anti-spam: only comment on noteworthy events |

#### Comment Format

```
🤖 [agent:claude-code] — Bug encountered

`cargo test auth::tests` fails with "connection refused"
→ Memory consulted: hint [0.72] "check DB migration"
→ Migration OK, problem is elsewhere
→ Fix applied: pool timeout increased in config.rs L87
→ Tests pass now ✅
```

#### Agent Identity for Comments

Kanwise comments require a `user_id` (FK to `users` table). The `users` table already has an `is_agent` boolean field (anticipated in migration v1).

On orchestrator startup, cortx registers a default agent user if none exists:
- username: `cortx-agent`
- `is_agent: true`
- This user_id is used for all agent comments

When Phase A adds multi-agent support, each agent gets its own user entry.

#### Implementation

- **`crates/kanwise/src/db.rs`**: Comments API already exists
- **`crates/cortx/src/orchestrator.rs`**: Add `comment_on_task(task_id, event_type, content)` method; register agent user on startup
- **`crates/cortx-types/src/lib.rs`**: Add `AgentCommentEvent` enum (Bug, Initiative, Decision, Dependency, Rollback, Completion, Escalation)

---

### C4: Escalation Protocol

When an agent is stuck (3 retries failed, or task beyond its scope):

1. Task receives label `needs-human`
2. Comment added with:
   - What was attempted (commands run)
   - Errors encountered
   - Memory hints consulted
   - Suggested resolution path
3. Agent moves to next available task (no blocking)
4. Human sees `needs-human` on the board, intervenes

#### Special Labels

| Label | Meaning |
|-------|---------|
| `ai-ready` | Task is ready for an agent to pick up |
| `in-progress` | Agent is working on it |
| `needs-human` | Agent is blocked, needs human help |
| `ai-done` | Agent completed, awaiting human review (optional) |

---

### C5: Sub-agents & Parallel Execution

#### Leveraging Claude Code's Built-in Parallelism

Instead of building a full multi-agent runtime (Phase A), we leverage Claude Code's sub-agent system with worktrees:

```
Claude Code (parent)
    │
    │ planning_decompose → 4 tasks on board
    │ Analyze dependencies → identify parallelizable groups
    │
    ├── Sub-agent 1 (worktree) → claim CORTX-12, execute
    ├── Sub-agent 2 (worktree) → claim CORTX-13, execute
    │   (parallel: no dependencies between 12 and 13)
    │
    │ Wait for results
    │
    ├── Sub-agent 3 (worktree) → claim CORTX-14
    │   (sequential: depends on 12+13)
    │
    │ Merge worktrees → resolve conflicts if any
    │
    ▼
    Morning report
```

#### New MCP Tool: `planning_claim_task`

```
planning_claim_task(board_id, agent_id)
```

Atomic version of `planning_next_task`:
1. Query: tasks with label `ai-ready` + not locked, ordered by priority
2. Atomic SQLite lock: `locked_by = agent_id, locked_at = now()`
3. Return the task to first claimer, others get next available
4. Timeout: auto-unlock based on last `proxy_exec` call timestamp (not a separate heartbeat). If no execution for 30min, the agent is considered dead.

#### Required Schema Migration (v9)

```sql
ALTER TABLE tasks ADD COLUMN locked_by TEXT;
ALTER TABLE tasks ADD COLUMN locked_at TEXT;
```

The lock is advisory — `locked_by` is set atomically via `UPDATE tasks SET locked_by = ?1, locked_at = ?2 WHERE id = ?3 AND locked_by IS NULL`. If the UPDATE affects 0 rows, the task is already claimed.

#### New MCP Tool: `planning_release_task`

```
planning_release_task(task_id, reason)
```

Release a claimed task back to the pool (on escalation or abandonment).

#### Branch Convention

```
cortx/<agent-id>/<task-id>-<slug>
```

Example: `cortx/sub-1/CORTX-12-setup-oauth`

---

### C6: Morning Report

At the end of an autonomous session, cortx generates a summary:

```
🌅 Session #47 — 6h12 autonomous work

✅ Completed: 4 tasks
  - [CORTX-12] Setup OAuth provider config
  - [CORTX-13] Add Google OAuth callback endpoint
  - [CORTX-14] Write integration tests for OAuth flow
  - [CORTX-16] Update API docs

⚠️ Escalated: 1 task
  - [CORTX-15] Frontend OAuth button — blocked on CORS,
    3 attempts, see comment

📊 Stats: 47 commands, 3 rollbacks, 12 hints used
💾 Memory: +6 causal chains, +2 project facts
```

#### Storage

- Stored in a dedicated `session_reports` table in context-db (avoids polluting FTS5 project_facts index with operational metadata)
- Posted as comment on the board (human-readable)
- Optionally written to a file (`reports/session-47.md`)

```sql
CREATE TABLE session_reports (
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
);
```

---

## Phase A — The Swarm Protocol (Future)

Deferred. The foundation is laid by B+C:
- **Atomic task claiming** (from C5)
- **Shared memory pool** (from B1-B3)
- **Comments protocol** (from C3)
- **Branch-per-agent convention** (from C5)

When the time comes, Phase A adds:
- Agent registry (identity, capabilities, status)
- Heartbeat protocol (liveness detection)
- Real-time multi-agent dashboard
- Cross-instance coordination (independent Claude Code / Codex / other agents)
- Advanced conflict resolution and merge strategies

---

## Delivery Order

```
B1  Pre-flight & post-flight in execute_and_remember
B2  Confidence reinforcement (bidirectional)
B3  Memory compaction (merge, prune, summarize)
 │
C1  planning_decompose (objective → tasks)
C2  Execute-test-commit loop + quality gates
C3  Agent comments protocol
C4  Escalation + labels
C5  Sub-agents parallel (claim_task + worktrees)
C6  Morning report
```

Each step is independently shippable and testable.

---

## Non-Goals (Explicit)

- **Cortx does NOT embed an LLM.** It orchestrates external agents.
- **Cortx does NOT spawn agents.** It coordinates agents that connect to it.
- **No multi-tenancy, billing, or SaaS infrastructure.** Open-source + consulting model.
- **No Lots 5-6 work** (dependencies, recurring tasks, webhooks, i18n) in this spec — orthogonal to the AI-native evolution.
- **Phase A (full Swarm)** is explicitly deferred.

## Resolved Questions

1. **Decomposition granularity**: Dropped. The agent decides granularity; cortx validates and persists.
2. **Quality gate configuration**: Yes — `cortx-gates.toml` follows the policy TOML pattern from rtk-proxy.
3. **Morning report format**: Board comment + dedicated `session_reports` table. Optional file export.

## Open Questions

1. **Memory export**: Should cross-project pattern sharing be part of B or deferred?
2. **Timeout status in pre-flight**: Should commands that previously timed out trigger enhanced pre-flight hints (e.g., "this command took >30s last time")?
