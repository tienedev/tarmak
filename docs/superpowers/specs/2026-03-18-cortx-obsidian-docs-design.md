# Cortx Obsidian Documentation — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Comprehensive personal documentation for the cortx project, hosted in Obsidian

---

## 1. Goal

Create a complete personal knowledge base for the cortx project inside the existing Obsidian vault at `/Users/tiene/Documents/Obsicoffre/cortx/`. The documentation serves one audience: the author. It should make it fast to re-orient after a break, recall past decisions, and navigate the codebase.

## 2. Constraints

- **Language:** English
- **Format:** Full Obsidian Flavored Markdown — wikilinks, callouts, frontmatter properties, tags, Mermaid diagrams
- **Location:** `/Users/tiene/Documents/Obsicoffre/cortx/`
- **Structure:** Flat with one sub-folder (`decisions/`) for ADRs. Navigation via a central MOC, wikilinks, and tags.
- **Existing files preserved:** `1er brainstorming.md`, `2026-03-18-cortx-architecture-design.md`, `sources.md` remain untouched.

## 3. Structure

```
cortx/
├── cortx MOC.md
├── Overview.md
├── Philosophy.md
├── Architecture.md
├── KBF Protocol.md
├── Tech Stack.md
├── Workflows.md
├── Roadmap.md
├── decisions/
│   ├── ADR-001 Monorepo Strategy.md
│   ├── ADR-002 KBF Over JSON.md
│   ├── ADR-003 SQLite Over Postgres.md
│   ├── ADR-004 Yjs CRDT Sync.md
│   ├── ADR-005 Single Binary Embed.md
│   ├── ADR-006 Four Organ Architecture.md
│   └── ADR-007 Security Pipeline.md
├── 1er brainstorming.md          (existing)
├── 2026-03-18-cortx-architecture-design.md  (existing)
└── sources.md                     (existing)
```

## 4. Page Specifications

### Frontmatter Convention

All pages use this base frontmatter (fields omitted when not applicable):

```yaml
---
tags: [cortx, <topic>]
created: 2026-03-18
---
```

The MOC additionally uses `aliases`. ADRs additionally use `status` and `supersedes`. Regular pages do not use `status` or `aliases`.

### 4.1 cortx MOC.md

Central hub. Frontmatter with `tags: [cortx, moc]`, `aliases: [cortx, cortx docs]`, and `created: 2026-03-18`. Body organized by theme with wikilinks:

- **Big Picture** — `[[Overview]]` · `[[Philosophy]]` · `[[Tech Stack]]`
- **Architecture** — `[[Architecture]]` · `[[KBF Protocol]]`
- **How I Work** — `[[Workflows]]`
- **Where It's Going** — `[[Roadmap]]`
- **Why I Chose X** — links to `decisions/` folder

Uses `> [!abstract]` callout for the project tagline.

### 4.2 Overview.md

Tags: `cortx`, `overview`. Sections:

1. **What is cortx** — single paragraph: AI-native kanban + dev orchestrator, single binary, self-hosted.
2. **The 4 Organs** — brief description of kanwise, rtk-proxy, context-db, orchestrator. Mermaid or ASCII diagram inside `> [!info]` callout.
3. **What Works Today** — bullet list of fully shipped features (Lot 1 + Lot 3). Partially shipped items from Lot 2 (export/import) noted separately.
4. **Current Status** — refactoring status (what's on main vs worktrees). Links to `[[Roadmap]]` and `[[Architecture]]`.

### 4.3 Philosophy.md

Tags: `cortx`, `philosophy`. Two sections:

1. **Core Beliefs** — 5 convictions:
   - Single binary, zero deps
   - AI-native, not AI-bolted
   - Token efficiency matters (KBF)
   - Security by architecture (7-layer pipeline)
   - Organs, not modules (single responsibility per crate)

2. **Design Principles** — CRDT-first collab, Rust for correctness + perf, React 19 embedded, self-hosted by default.

No code. Links to `[[Architecture]]` and `[[KBF Protocol]]` for the how.

### 4.4 Architecture.md

Tags: `cortx`, `architecture`. Sections:

1. **Monorepo Structure** — workspace layout, Mermaid diagram of crate dependencies.
2. **Kanwise (Planning Organ)** — Axum REST API, SQLite, WebSocket + Yjs, MCP server (board_query, board_mutate, board_sync — plus board_ask per architecture spec), embedded frontend.
3. **KBF Protocol** — brief summary with `> [!tip] See [[KBF Protocol]]` callout.
4. **rtk-proxy (Action Organ)** — planned. 7-layer pipeline diagram. MCP tools: proxy_exec, proxy_status, proxy_rollback.
5. **context-db (Memory Organ)** — planned. Execution tracking, causal chains, FTS5, confidence decay. MCP tools: memory_store, memory_recall, memory_status.
6. **Cortx Orchestrator** — planned. Meta-MCP, execute_and_remember loop. Link to `[[Philosophy]]`.
7. **Further Reading** — `> [!info] See [[2026-03-18-cortx-architecture-design]] for the full spec` callout linking to the existing 96KB architecture document in the vault.
8. **Data Flow** — two callouts:
   - `> [!example] Flux A: Assisted Mode (MCP)` — human → Claude → orchestrator → organs → response
   - `> [!example] Flux B: Autonomous Mode (API)` — planned. Cron → orchestrator → kanwise → API → proxy → commit

### 4.5 KBF Protocol.md

Tags: `cortx`, `architecture`, `kbf`. Sections:

1. **Why It Exists** — token cost problem, ~95% reduction.
2. **How It Works** — schema-based encoding, encode/decode paths, used by MCP board_sync.
3. **Crate Structure** — file paths: lib.rs, schema.rs, encode.rs, decode.rs.
4. **Trade-offs** — pro (token savings), con (not human-readable), mitigation (JSON fallback in MCP tools).

Uses `> [!abstract]` callout for the tagline.

### 4.6 Tech Stack.md

Tags: `cortx`, `reference`. Three tables:

1. **Backend (Rust 2024)** — concern → library (Axum, Tokio, rusqlite, Yjs, Argon2, rmcp, clap, serde).
2. **Frontend (React 19)** — concern → library (Vite, Tailwind v4, shadcn/ui, Tiptap, @dnd-kit, Zustand v5, Vitest, Playwright).
3. **DevOps** — concern → tool (GitHub Actions, Docker, single binary deploy).

Pure lookup tables. No prose.

### 4.7 Workflows.md

Tags: `cortx`, `workflow`. Sections:

1. **Dev Loop** — `> [!tip]` quick start callout: `make install` → `make dev`.
2. **Build & Run** — table: command → what it does (make install, make dev, make build, make clean, make kill).
3. **Testing** — table: scope → command (cargo test, clippy, npm run test, npx playwright test).
4. **Branching & Worktrees** — git worktree workflow, list of active worktrees.
5. **MCP Setup** — setup-claude.sh, mcp-config.json reference.
6. **Docker** — docker-compose up, volume persistence.
7. **Backup & Restore** — planned (Lot 2), kanwise backup/restore commands.

### 4.8 Roadmap.md

Tags: `cortx`, `roadmap`. Sections:

1. **Lot 1–6** — one section per lot with status emoji (✅, 🔲, 🚧), brief description of scope.
2. **Cortx Refactoring** — `> [!warning]` callout for in-progress status. Table: phase → scope → status.
3. **Feature Ideas** — `> [!note]` callout as parking lot for uncommitted ideas (Flux B autonomous loop, @ai-ready tags, agent activity dashboard).

### 4.9 ADR Template and Initial Records

Each ADR in `decisions/` follows this template:

```markdown
---
tags:
  - cortx
  - decision
status: accepted
created: YYYY-MM-DD
supersedes: (optional)
---

# ADR-NNN: Title

## Context
What situation or problem triggered this decision.

## Options Considered
1. **Option A** — description + trade-offs
2. **Option B** — description + trade-offs

## Decision
What was chosen and why.

## Consequences
What follows — good and bad.
```

**Initial ADRs** (extracted from existing specs and brainstorming):

| ADR | Title | Key rationale |
|-----|-------|---------------|
| ADR-001 | Monorepo Strategy | Keep GitHub stars, single CI, shared crates. Kanwise becomes internal crate. |
| ADR-002 | KBF Over JSON | ~95% token reduction for agent communication. Wire protocol > serialization format. |
| ADR-003 | SQLite Over Postgres | Zero-dep, embedded, single-file backup. Self-hosted simplicity. |
| ADR-004 | Yjs CRDT Sync | No custom conflict resolution to maintain. Battle-tested. |
| ADR-005 | Single Binary Embed | rust-embed serves React frontend. No separate deploy. One file = one service. |
| ADR-006 | Four Organ Architecture | Single responsibility per crate. Planning, action, memory, orchestration. Composable via traits. |
| ADR-007 | Security Pipeline | 7-layer defense for rtk-proxy. Autonomous agents must be sandboxed. Policy → tiers → budget → sandbox. |

## 5. Obsidian Features

| Feature | Usage |
|---------|-------|
| Frontmatter properties | `tags` + `created` on all pages; `aliases` on MOC only; `status` + `supersedes` on ADRs only |
| Wikilinks `[[...]]` | All cross-references between pages |
| Callouts | `> [!abstract]`, `> [!tip]`, `> [!warning]`, `> [!info]`, `> [!example]`, `> [!note]` |
| Mermaid | Architecture diagrams in Architecture.md |
| Tags | `#cortx`, `#architecture`, `#workflow`, `#decision`, `#roadmap`, `#philosophy`, `#reference`, `#kbf`, `#overview`, `#moc` (all lowercase) |

## 6. Content Sources

All content is extracted and condensed from existing project files:

| Source | Used for |
|--------|----------|
| `docs/superpowers/specs/2026-03-18-cortx-architecture-design.md` | Architecture, KBF Protocol, ADRs |
| `docs/superpowers/roadmap.md` | Roadmap |
| `README.md` | Overview, Tech Stack, Workflows |
| `1er brainstorming.md` (Obsidian) | Philosophy, ADR-006 |
| `Cargo.toml`, `package.json` | Tech Stack tables |
| `Makefile` | Workflows |
| `.github/workflows/ci.yml` | Workflows (CI) |

## 7. What Stays Out

- No API reference — code is the source of truth
- No contributor guide — personal documentation only
- No tutorials — the author knows how it works
- No duplication of the full 96KB architecture spec — Architecture.md is a condensed navigational version that links to the existing spec for deep dives
