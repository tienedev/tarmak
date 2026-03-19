# Cortx AI-Native Evolution — Design Spec

**Date:** 2026-03-19
**Status:** Phase B + C implemented. Phase A deferred.
**Author:** tiene + Claude

## Overview

Cortx is an AI-native development orchestrator. This spec defined three phases that transformed it from a kanban + execution + memory toolkit into a self-improving autonomous development environment.

### Phases

| Phase | Name | Status |
|-------|------|--------|
| **B** | The Learning Machine | Implemented (PR #26) |
| **C** | The Autonomous Pipeline | Implemented (PR #26, #27) |
| **A** | The Swarm Protocol | Deferred |

### What was delivered (B + C)

- **Active memory**: Pre-flight recall before execution, post-flight reinforcement, hint correlation
- **Bidirectional confidence**: Reinforcement on success (+0.15), decay on churn, penalty on failure (-0.20)
- **Memory compaction**: Merge duplicates, prune stale chains, summarize execution history
- **Task decomposition**: `planning_decompose` — objective to ordered tasks with dependency validation
- **Atomic task claiming**: `planning_claim_task` / `planning_release_task` with advisory locks
- **Quality gates**: `planning_validate_gates` with configurable `cortx-gates.toml`
- **Agent comments**: Structured comments on tickets (bugs, initiatives, decisions, escalations)
- **Escalation protocol**: `planning_escalate` with `needs-human` label
- **Morning reports**: `session_report` with execution stats stored in `session_reports` table

---

## Phase A — The Swarm Protocol (Future)

The foundation is laid by B+C:
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

## Non-Goals

- **Cortx does NOT embed an LLM.** It orchestrates external agents.
- **Cortx does NOT spawn agents.** It coordinates agents that connect to it.
- **No multi-tenancy, billing, or SaaS infrastructure.** Open-source + consulting model.

## Open Questions

1. **Memory export**: Should cross-project pattern sharing be a future feature?
2. **Timeout hints**: Should commands that previously timed out trigger enhanced pre-flight hints?
