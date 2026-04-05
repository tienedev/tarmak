# Tarmak Full TypeScript Migration — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Context:** Migrate Tarmak from Rust+TypeScript to full TypeScript monorepo. The team has stronger TS expertise than Rust, and for an internal tool serving 5-20 users, the performance trade-off is negligible.

---

## 1. Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Monorepo | Turborepo + pnpm workspaces | Task orchestration, caching, dependency graph |
| Frontend | React 19 + Vite + Tailwind + shadcn/ui | Existing frontend, minimal changes |
| Backend HTTP | Hono 4.x | HTTP server, WebSocket, middleware, static file serving |
| API layer | tRPC 11.x | End-to-end type-safe API, replaces REST |
| Auth | Better Auth 1.x | Sessions, API keys, invitations, roles |
| ORM | Drizzle ORM 0.40+ | Type-safe schema, queries, migrations |
| SQLite driver | better-sqlite3 11.x | Synchronous driver (most performant for SQLite on Node) |
| CRDT | Yjs 13.x | Real-time sync, native JS (replaces Yrs Rust port) |
| MCP | @modelcontextprotocol/sdk 1.27+ | Stdio + Streamable HTTP transports |
| Validation | Zod 3.x (verify compat with tRPC 11 + Better Auth before pinning) | Shared schemas across tRPC, Better Auth, Drizzle |
| Logging | pino 9.x | Structured logging |
| Lint/Format | Biome | Replaces ESLint, faster, zero config |
| Package build | tsup | Build shared packages |
| Dev runner | tsx | Direct TS execution for api and agent |
| Unit tests | Vitest | All packages |
| E2E tests | Playwright | Existing, unchanged |

## 2. Monorepo Structure

```
tarmak/
├── turbo.json
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── shared/                  # @tarmak/shared — contracts only
│   ├── db/                      # @tarmak/db — persistence layer
│   └── kbf/                     # @tarmak/kbf — Kanban Bit Format codec
├── apps/
│   ├── api/                     # Hono + tRPC + Better Auth + MCP
│   ├── web/                     # React 19 + Vite (existing, adapted)
│   └── agent/                   # Agent server (migrated to Hono)
├── skills/                      # Claude Code plugin (unchanged)
├── Makefile
├── Dockerfile
└── .github/workflows/
```

## 3. Package Design

### 3.1 `@tarmak/shared` — Contracts

Zero business logic. Only types, Zod schemas, and constants shared across 2+ packages.

```
packages/shared/src/
├── types/
│   ├── board.ts          # Board, Column, Task, Priority, TaskStatus
│   ├── user.ts           # User, Role, Permission
│   ├── label.ts          # Label, TaskLabel
│   ├── comment.ts        # Comment
│   ├── subtask.ts        # Subtask
│   ├── attachment.ts     # Attachment
│   ├── custom-field.ts   # CustomField, FieldType, FieldValue
│   ├── notification.ts   # Notification, NotificationType
│   └── agent.ts          # AgentSession, AgentStatus
├── schemas/
│   ├── board.ts          # Zod schemas for board operations
│   ├── task.ts           # createTaskSchema, updateTaskSchema, moveTaskSchema
│   ├── user.ts           # loginSchema, registerSchema, inviteSchema
│   └── ...               # One schema file per domain
├── constants/
│   ├── priorities.ts
│   ├── roles.ts
│   └── limits.ts         # Rate limits, max sizes
└── index.ts
```

**Rule:** If a type or schema is used by 2+ packages, it goes in shared. Otherwise it stays local.

### 3.2 `@tarmak/db` — Persistence Layer

Encapsulates all data access. No other package touches SQLite directly.

```
packages/db/src/
├── schema/
│   ├── boards.ts
│   ├── columns.ts
│   ├── tasks.ts
│   ├── users.ts
│   ├── labels.ts
│   ├── comments.ts
│   ├── subtasks.ts
│   ├── attachments.ts
│   ├── custom-fields.ts
│   ├── notifications.ts
│   ├── crdt.ts
│   ├── agent.ts
│   ├── search.ts         # FTS5 virtual table (raw SQL, not Drizzle DSL)
│   └── index.ts          # Relations + re-export all tables
├── repo/
│   ├── boards.ts
│   ├── tasks.ts          # Includes claimTask / releaseTask with advisory locks
│   ├── columns.ts
│   ├── labels.ts
│   ├── comments.ts
│   ├── subtasks.ts
│   ├── attachments.ts
│   ├── custom-fields.ts
│   ├── notifications.ts
│   ├── search.ts         # Full-text search via FTS5
│   ├── crdt.ts           # CRDT state persistence
│   ├── archive.ts        # Archive/unarchive tasks and columns
│   └── agent.ts
├── migrations/           # Drizzle Kit generated + raw SQL for FTS5 triggers
├── connection.ts         # createDb(path) / createDb(':memory:') for tests
├── seed.ts               # Dev seed data
└── index.ts
```

**Repo pattern:** Pure functions taking `db` as parameter. No singletons, fully injectable for tests.

```ts
export function createTask(db: Database, input: CreateTaskInput) { ... }
export function claimTask(db: Database, taskId: string, agentId: string) { ... }
```

**FTS5 note:** SQLite FTS5 virtual tables, triggers (on tasks, comments, subtasks), and the search index require raw SQL outside Drizzle's schema DSL. These are maintained as custom SQL migrations alongside Drizzle-generated ones.

### 3.3 `@tarmak/kbf` — Kanban Bit Format Codec

Isolated, zero external dependencies. Tested with binary fixtures.

```
packages/kbf/src/
├── encode.ts             # encodeFull(), encodeDelta()
├── decode.ts             # decodeFull(), decodeDelta()
├── schema.ts             # Zod validation of payloads before encoding
├── types.ts              # KbfBoard, KbfDelta (internal codec types)
└── index.ts
```

Uses `Buffer` / `DataView` for binary manipulation.

## 4. App Design

### 4.1 `apps/api` — Backend

Orchestrates modules. Business orchestration logic (task claiming, decomposition, planning) lives in a dedicated service layer.

```
apps/api/src/
├── index.ts              # Entry point: start HTTP server or MCP (based on args)
├── app.ts                # Hono app: mount middleware + routes
├── middleware/
│   ├── security.ts       # Security headers: CSP, HSTS, X-Content-Type-Options, X-Frame-Options
│   ├── static.ts         # Hono serve-static for embedded frontend in production
│   └── rate-limit.ts     # IP-based rate limiting
├── services/
│   ├── board.ts          # Board orchestration (duplicate with relations, etc.)
│   ├── task.ts           # Task orchestration: claim, release, complete, decompose (DAG validation)
│   └── notifications.ts  # Notification dispatch logic
├── trpc/
│   ├── router.ts         # Root appRouter = merge of all sub-routers
│   ├── context.ts        # createContext(): { db, user, session }
│   ├── middleware/
│   │   ├── auth.ts       # protectedProcedure (session required)
│   │   └── roles.ts      # requireRole('owner' | 'member')
│   └── procedures/
│       ├── boards.ts     # CRUD + members + duplicate
│       ├── tasks.ts      # CRUD + move + claim/release
│       ├── columns.ts    # CRUD + move + archive
│       ├── labels.ts     # CRUD + attach/detach
│       ├── comments.ts
│       ├── subtasks.ts
│       ├── attachments.ts  # Upload via Hono multipart, not tRPC
│       ├── custom-fields.ts
│       ├── notifications.ts  # List, markRead, SSE stream with ticket-based auth
│       ├── search.ts
│       ├── archive.ts    # Archive/unarchive tasks and columns, list archived
│       ├── agent.ts      # Agent sessions: create, get, update, list, cancel
│       └── activity.ts
├── auth/
│   └── config.ts         # Better Auth: email/password, sessions, API keys, invitations, org roles
├── mcp/
│   ├── server.ts         # McpServer: registers 4 tools (unified across both transports)
│   ├── tools/
│   │   ├── board-query.ts
│   │   ├── board-mutate.ts
│   │   ├── board-sync.ts
│   │   └── board-ask.ts  # NLP query parsing
│   └── transport.ts      # Stdio + Streamable HTTP
├── sync/
│   ├── ws.ts             # WebSocket upgrade + Yjs sync protocol
│   └── doc-manager.ts    # Y.Doc lifecycle: load, persist, broadcast, cleanup
├── background/
│   ├── deadlines.ts      # Overdue tasks → notifications
│   └── sessions.ts       # Expired session cleanup
├── notifications/
│   └── broadcaster.ts    # EventEmitter for SSE + WebSocket push
└── cli/
    ├── backup.ts
    ├── restore.ts
    ├── export.ts
    ├── import.ts
    └── users.ts
```

**Service layer:** The current Rust codebase has a `Tarmak` struct (`lib.rs`) that orchestrates task claiming, releasing, decomposition (with DAG validation), and completion. This logic does not belong in tRPC procedures (too thin) or in the repo layer (too low-level). The `services/` directory provides this orchestration layer:

```ts
// apps/api/src/services/task.ts
export class TaskService {
  constructor(private db: Database) {}
  claimTask(taskId: string, agentId: string) { ... }
  releaseTask(taskId: string) { ... }
  decompose(taskId: string, subtasks: DecomposeInput) { ... } // DAG validation
  completeTask(taskId: string, summary: string) { ... }
  getNextTask(boardId: string) { ... }
}
```

**Notification SSE auth:** Browsers cannot set headers on EventSource. The current system uses a ticket-based flow: client calls `createStreamTicket` (authenticated tRPC mutation) → gets a short-lived token → passes it as query param to the SSE endpoint. This pattern is preserved.

**Static file serving:** In production, `hono/serve-static` middleware serves the built frontend with SPA fallback (all non-API routes → `index.html`). In dev, Vite serves the frontend directly.

### 4.2 `apps/web` — Frontend

Primary change: tRPC client replaces the hand-written REST api.ts.

```
apps/web/src/
├── lib/
│   ├── trpc.ts           # tRPC client + React Query integration
│   ├── sync.ts           # Yjs (unchanged)
│   └── ...
├── stores/               # Zustand — stores call tRPC instead of fetch
├── pages/                # Unchanged
├── components/           # Unchanged
├── i18n/                 # i18next setup + EN/FR locales (unchanged, migrated as-is)
└── ...
```

### 4.3 `apps/agent` — Agent Server

Hono replaces Fastify. All existing modules preserved.

```
apps/agent/src/
├── index.ts              # Entry point, CLI argument parsing
├── server.ts             # Hono app + WebSocket for streaming
├── sdk.ts                # Claude Agent SDK config
├── config.ts             # Agent configuration, tool registration
├── detect.ts             # Project detection (package manager, framework)
├── callback.ts           # Reports session events back to main server
├── worktree.ts           # Git worktree management
├── repo-cache.ts         # Maps repo URLs to local paths (JSON persistence)
├── token.ts              # Token generation and persistence
└── types.ts
```

**Note:** The agent communicates with the API server over HTTP at runtime. It has no build-time dependency on `apps/api` — only on `@tarmak/shared` for types.

## 5. Dependency Graph

```
@tarmak/shared ──────────────────────────────────┐
     │                                            │
     ▼                                            ▼
@tarmak/db          @tarmak/kbf      apps/web    apps/agent
     │                   │                        (HTTP → apps/api at runtime)
     ▼                   │
  apps/api ◄─────────────┘
```

No circular dependencies. Flow always goes: shared → packages → apps.
`apps/agent` depends on `@tarmak/shared` at build time and communicates with `apps/api` via HTTP at runtime only.

## 6. Key Architectural Decisions

### 6.1 tRPC replaces REST

- All API calls become typed procedure calls
- Frontend uses `@trpc/react-query` for data fetching + caching
- Attachments use Hono multipart routes (binary upload not suited for tRPC)
- WebSocket and SSE remain separate from tRPC (real-time transport)

### 6.2 Better Auth replaces custom auth

Covers: email/password, session management, API keys, invitations, role-based access.
Custom auth code (Rust auth module + auth routes + middleware + validation) is replaced entirely.
Input validation schemas (email format, password strength, board name length) move to Zod schemas in `@tarmak/shared` — these are not part of Better Auth.

### 6.3 Drizzle + better-sqlite3

- Synchronous driver is more performant than async wrappers for SQLite on Node.js
- Drizzle Kit handles migration generation from schema changes
- Schema is the single source of truth (no separate migration files to write by hand)
- FTS5 virtual tables and triggers require raw SQL migrations alongside Drizzle-generated ones
- `createDb(':memory:')` for test isolation
- **Trade-off:** Synchronous SQLite means CRDT persistence writes (encoding full Y.Doc state) block the event loop. For 5-20 users this is fine. If scaling beyond, CRDT persistence can be offloaded to a `worker_thread`.

### 6.4 Yjs native replaces Yrs

Yjs is the original JS library; Yrs was its Rust port. Moving to Yjs simplifies the sync layer — same API as the frontend already uses.

### 6.5 MCP via official TypeScript SDK

- `@modelcontextprotocol/sdk` v1.27+
- 4 tools: board_query, board_mutate, board_sync, board_ask (unified across both transports — the current codebase has board_ask only on stdio, this migration unifies it)
- Transports: stdio (CLI integration) + Streamable HTTP (remote)
- **Breaking change:** The current SSE transport uses `rmcp`'s custom SSE protocol. The TS SDK uses Streamable HTTP, which is a different protocol. Any external clients connecting via SSE will need to migrate to Streamable HTTP. Skills plugin and Claude Code connect via stdio (unaffected).

### 6.6 Biome replaces ESLint

Faster, zero-config lint + format. Single tool for the entire monorepo.

### 6.7 Error handling

tRPC provides structured errors via `TRPCError`. Mapping from current Rust `ApiError` enum:

| Rust ApiError | tRPC Error Code |
|--------------|-----------------|
| BadRequest | `BAD_REQUEST` |
| Unauthorized | `UNAUTHORIZED` |
| Forbidden | `FORBIDDEN` |
| NotFound | `NOT_FOUND` |
| Conflict | `CONFLICT` |
| TooManyRequests | `TOO_MANY_REQUESTS` |
| Internal | `INTERNAL_SERVER_ERROR` |

Custom error formatter in tRPC to include structured error details (field validation errors, etc.) in the response.

## 7. Turborepo Pipeline

```jsonc
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

Build order enforced by `dependsOn: ["^build"]`: shared → db, kbf → api, web, agent.

## 8. Testing Strategy

| Package | Strategy |
|---------|----------|
| `@tarmak/shared` | Unit tests on Zod schemas |
| `@tarmak/db` | Integration tests with `createDb(':memory:')` |
| `@tarmak/kbf` | Unit tests with binary fixtures (encode → decode roundtrip) |
| `apps/api` | Integration tests via tRPC caller (no HTTP server needed) |
| `apps/web` | Vitest + Testing Library (unchanged) |
| `apps/agent` | Unit tests on config/detect |
| E2E | Playwright (unchanged) |

tRPC caller pattern for backend tests:
```ts
const caller = appRouter.createCaller({ db: testDb, user: mockUser })
const board = await caller.boards.create({ name: 'Test' })
```

## 9. Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | API server port | `4000` |
| `DATABASE_PATH` | SQLite database file | `./tarmak.db` |
| `TARMAK_ALLOWED_ORIGINS` | CORS whitelist | `http://localhost:3000` |
| `RATE_LIMIT_MAX` | Max requests per window | `100` |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | `60` |
| `TARMAK_EMAIL` | Auto-login email for agent dev | — |
| `TARMAK_PASSWORD` | Auto-login password for agent dev | — |
| `TARMAK_TOKEN` | Pre-set auth token for agent | — |
| `AGENT_PORT` | Agent server port | `9876` |
| `BETTER_AUTH_SECRET` | Better Auth secret key | — (required) |

## 10. Data Migration Strategy

The current system uses a custom migration system (`schema_version` table, V1-V10). Drizzle uses its own migration tracking. Three options:

**Option A — Export/Import cycle (recommended):**
1. Use existing `tarmak export` CLI to dump all boards as JSON
2. Deploy new TS server with fresh Drizzle-managed schema
3. Use new `import` CLI to load the JSON data
4. Verify data integrity

**Option B — Schema compatibility layer:**
1. Write a one-time script that adds Drizzle's migration metadata to the existing database
2. Ensure Drizzle schema exactly matches existing tables
3. Drizzle "adopts" the existing database as-is
4. Better Auth tables added via migration

**Option C — Fresh start:**
- For small teams (5-20 users), manually recreating boards may be faster than migrating
- Only viable if the team accepts losing history

**Recommendation:** Option A. The export/import tools already exist and produce clean JSON. This avoids schema compatibility risks entirely. Better Auth tables are created fresh by the new server.

## 11. Docker

Simplified from multi-stage Rust build to single Node.js image:

```dockerfile
FROM node:22-alpine AS builder
# pnpm install + turbo build

FROM node:22-alpine AS runtime
# Copy built api + web dist
# Single entry point: node apps/api/dist/index.js
```

No more Rust compilation step. Build time drops significantly.

## 12. CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `ci.yml` | All pushes | typecheck → lint → test → build (Turborepo handles caching + ordering) |
| `e2e.yml` | frontend/e2e changes | Build api + web → Playwright |
| `deploy.yml` | Merge to main | Docker build + push to ghcr.io |

Single CI workflow replaces separate backend.yml + frontend.yml — Turborepo's affected filter runs only what changed.

## 13. Migration Strategy

Incremental migration in this order:

1. **Scaffold monorepo** — Turborepo + pnpm workspaces + Biome
2. **@tarmak/shared** — Extract types and schemas from existing Rust models + frontend types
3. **@tarmak/kbf** — Port binary codec from Rust to TypeScript
4. **@tarmak/db** — Drizzle schema matching existing SQLite tables, FTS5 raw SQL, repo functions by domain
5. **apps/api — core** — Hono server, security middleware, Better Auth, tRPC scaffold, service layer (task orchestration, decompose)
6. **apps/api — procedures** — tRPC procedures for all entities (boards, tasks, columns, labels, comments, subtasks, attachments, custom fields, notifications, search, archive, agent sessions, activity)
7. **apps/api — realtime** — WebSocket sync (Yjs), notification SSE with ticket auth, background jobs
8. **apps/api — MCP** — McpServer with 4 tools, stdio + Streamable HTTP transports
9. **apps/api — CLI** — backup, restore, export, import, users
10. **apps/web** — Replace api.ts with tRPC client, update stores, preserve i18n
11. **apps/agent** — Migrate from Fastify to Hono, preserve all modules (callback, token, repo-cache)
12. **Docker + CI** — Update Dockerfile and GitHub Actions
13. **Data migration** — Export from old system, import into new
14. **Cleanup** — Remove Rust crates, Cargo files, old configs

Steps 5-9 break up the large API migration into focused, testable chunks.
