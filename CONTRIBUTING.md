# Contributing to Tarmak

Thanks for your interest in contributing to Tarmak! Here's how to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/)

## Setup

```bash
git clone https://github.com/tienedev/tarmak.git
cd tarmak
cp .env.example .env
make install
make dev
```

This starts the backend (`:4000`), agent server (`:9876`), and frontend (`:3000`).

## Project structure

```
packages/
  shared/      # Types, Zod schemas, constants
  db/          # Drizzle ORM + SQLite schema + repos
  kbf/         # Kanban Bit Format codec
apps/
  api/         # Hono + tRPC + Better Auth + MCP + WebSocket
  web/         # React 19 + Vite + Tailwind + shadcn/ui
  agent/       # Claude Agent SDK + Hono server
skills/        # Claude Code plugin — skills, agents, hooks
```

## Development workflow

1. Create a branch from `main`
2. Make your changes
3. Run the checks (see below)
4. Open a pull request

## Code style

Enforced by CI:

```bash
make lint     # Biome lint + format check
make test     # Vitest for all packages
```

E2E tests (requires backend running):

```bash
cd frontend && npx playwright test
```

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add board duplication
fix: prevent race condition in task claiming
docs: update MCP configuration example
refactor: extract auth middleware
test: add E2E tests for invite links
chore: bump dependencies
```

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Include a description of what changed and why
- Make sure CI passes before requesting review
- E2E tests are required for user-facing changes

## Architecture notes

See [CLAUDE.md](CLAUDE.md) for detailed codebase patterns and conventions.

Key patterns:
- tRPC for end-to-end type-safe API
- Drizzle ORM with better-sqlite3 for synchronous DB access
- CRDT sync via Yjs over WebSocket
- KBF for compact board serialization
- Better Auth for authentication (email/password + sessions)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
