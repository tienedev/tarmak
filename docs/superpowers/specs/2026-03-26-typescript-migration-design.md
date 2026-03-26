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
| Backend HTTP | Hono 4.x | HTTP server, WebSocket, middleware |
| API layer | tRPC 11.x | End-to-end type-safe API, replaces REST |
| Auth | Better Auth 1.x | Sessions, API keys, invitations, roles |
| ORM | Drizzle ORM 0.40+ | Type-safe schema, queries, migrations |
| SQLite driver | better-sqlite3 11.x | Synchronous driver (most performant for SQLite on Node) |
| CRDT | Yjs 13.x | Real-time sync, native JS (replaces Yrs Rust port) |
| MCP | @modelcontextprotocol/sdk 1.27+ | Stdio + Streamable HTTP transports |
| Validation | Zod 3.x | Shared schemas across tRPC, Better Auth, Drizzle |
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
│   ├── search.ts         # Full-text search
│   ├── crdt.ts           # CRDT state persistence
│   └── agent.ts
├── migrations/           # Drizzle Kit generated
├── connection.ts         # createDb(path) / createDb(':memory:') for tests
├── seed.ts               # Dev seed data
└── index.ts
```

**Repo pattern:** Pure functions taking `db` as parameter. No singletons, fully injectable for tests.

```ts
export function createTask(db: Database, input: CreateTaskInput) { ... }
export function claimTask(db: Database, taskId: string, agentId: string) { ... }
```

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

Orchestrates modules, contains no raw business logic.

```
apps/api/src/
├── index.ts              # Entry point: start HTTP server or MCP (based on args)
├── app.ts                # Hono app: mount middleware + routes
├── trpc/
│   ├── router.ts         # Root appRouter = merge of all sub-routers
│   ├── context.ts        # createContext(): { db, user, session }
│   ├── middleware/
│   │   ├── auth.ts       # protectedProcedure (session required)
│   │   ├── roles.ts      # requireRole('owner' | 'member')
│   │   └── rate-limit.ts
│   └── procedures/
│       ├── boards.ts     # CRUD + members + duplicate
│       ├── tasks.ts      # CRUD + move + claim/release
│       ├── columns.ts    # CRUD + move + archive
│       ├── labels.ts     # CRUD + attach/detach
│       ├── comments.ts
│       ├── subtasks.ts
│       ├── attachments.ts  # Upload via Hono multipart, not tRPC
│       ├── custom-fields.ts
│       ├── notifications.ts
│       ├── search.ts
│       ├── agent.ts
│       └── activity.ts
├── auth/
│   └── config.ts         # Better Auth setup: providers, session, API keys, invitations
├── mcp/
│   ├── server.ts         # McpServer: registers 4 tools
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
└── ...
```

### 4.3 `apps/agent` — Agent Server

Same structure, Hono replaces Fastify.

```
apps/agent/src/
├── index.ts
├── server.ts             # Hono app + WebSocket
├── sdk.ts                # Claude Agent SDK config
├── config.ts             # Tool registration
├── detect.ts             # Project detection
├── worktree.ts           # Git worktree management
└── types.ts
```

## 5. Dependency Graph

```
@tarmak/shared ──────────────────────────┐
     │                                    │
     ▼                                    ▼
@tarmak/db          @tarmak/kbf      apps/web
     │                   │
     ▼                   │
  apps/api ◄─────────────┘
     │
     ▼
  apps/agent
```

No circular dependencies. Flow always goes: shared → packages → apps.

## 6. Key Architectural Decisions

### 6.1 tRPC replaces REST

- All API calls become typed procedure calls
- Frontend uses `@trpc/react-query` for data fetching + caching
- Attachments use Hono multipart routes (binary upload not suited for tRPC)
- WebSocket and SSE remain separate from tRPC (real-time transport)

### 6.2 Better Auth replaces custom auth

Covers: email/password, session management, API keys, invitations, role-based access.
Custom auth code (~700 LOC Rust: auth module + auth routes + middleware) is replaced entirely.

### 6.3 Drizzle + better-sqlite3

- Synchronous driver is more performant than async wrappers for SQLite on Node.js
- Drizzle Kit handles migration generation from schema changes
- Schema is the single source of truth (no separate migration files to write by hand)
- `createDb(':memory:')` for test isolation

### 6.4 Yjs native replaces Yrs

Yjs is the original JS library; Yrs was its Rust port. Moving to Yjs simplifies the sync layer — same API as the frontend already uses.

### 6.5 MCP via official TypeScript SDK

- `@modelcontextprotocol/sdk` v1.27+
- 4 tools: board_query, board_mutate, board_sync, board_ask
- Transports: stdio (CLI integration) + Streamable HTTP (remote)
- SSE transport code from Rust is no longer needed (SDK handles it)

### 6.6 Biome replaces ESLint

Faster, zero-config lint + format. Single tool for the entire monorepo.

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

## 9. Docker

Simplified from multi-stage Rust build to single Node.js image:

```dockerfile
FROM node:22-alpine AS builder
# pnpm install + turbo build

FROM node:22-alpine AS runtime
# Copy built api + web dist
# Single entry point: node apps/api/dist/index.js
```

No more Rust compilation step. Build time drops significantly.

## 10. CI/CD

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `ci.yml` | All pushes | typecheck → lint → test → build (Turborepo handles caching + ordering) |
| `e2e.yml` | frontend/e2e changes | Build api + web → Playwright |
| `deploy.yml` | Merge to main | Docker build + push to ghcr.io |

Single CI workflow replaces separate backend.yml + frontend.yml — Turborepo's affected filter runs only what changed.

## 11. Migration Strategy

Incremental migration in this order:

1. **Scaffold monorepo** — Turborepo + pnpm workspaces + Biome
2. **@tarmak/shared** — Extract types and schemas from existing Rust models + frontend types
3. **@tarmak/kbf** — Port binary codec from Rust to TypeScript
4. **@tarmak/db** — Drizzle schema matching existing SQLite, repo functions ported from repo.rs
5. **apps/api** — Hono server with tRPC, Better Auth, MCP, sync (biggest step)
6. **apps/web** — Replace api.ts with tRPC client, update stores
7. **apps/agent** — Migrate from Fastify to Hono
8. **Docker + CI** — Update Dockerfile and GitHub Actions
9. **Cleanup** — Remove Rust crates, Cargo files, old configs

Each step is independently deployable and testable.
