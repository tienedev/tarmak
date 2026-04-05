# Tarmak

Kanban board for AI-assisted development. TypeScript monorepo with Turborepo, Hono, tRPC, Drizzle.

## Architecture

```
packages/
  shared/      # Types, Zod schemas, constants
  db/          # Drizzle ORM + SQLite schema + repos
  kbf/         # Kanban Bit Format codec
apps/
  api/         # Hono + tRPC + Better Auth + MCP + WebSocket
  web/         # React 19 + Vite + Tailwind + shadcn/ui
  agent/       # Claude Agent SDK + Hono server
```

## Commands

```bash
make install          # Install dependencies
make dev              # Start all dev servers (backend 4000 + agent 9876 + frontend 3000)
make back             # Backend only
make front            # Frontend only with HMR
make agent            # Agent server only
make build            # Production build
make clean            # Clean all build artifacts
make kill             # Kill running dev processes
make test             # Run all tests
make lint             # Lint all packages
```

## Key patterns

- tRPC for end-to-end type-safe API
- Drizzle ORM with better-sqlite3 for synchronous DB access
- CRDT sync via Yjs over WebSocket
- KBF (Kanban Bit Format) for compact board serialization
- Better Auth for authentication (email/password + sessions)
- MCP server with 4 tools (board_query, board_mutate, board_sync, board_ask)

## Testing

- `vitest` for all packages
- In-memory SQLite (`createDb()` with no args) for DB tests
- tRPC tests use `appRouter.createCaller(ctx)` pattern

## Environment

Copy `.env.example` to `.env`. Required vars:
- `BETTER_AUTH_SECRET` — auth secret
- `TARMAK_EMAIL` / `TARMAK_PASSWORD` — for `make agent` auto-login
