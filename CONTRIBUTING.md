# Contributing to Tarmak

Thanks for your interest in contributing to Tarmak! Here's how to get started.

## Prerequisites

- [Rust](https://rustup.rs/) (channel set by `rust-toolchain.toml`)
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
crates/
  tarmak/        # Kanban server — REST, WebSocket, MCP, agent, CLI
  kbf/           # Kanban Bit Format codec
frontend/        # React 19 + TypeScript + Tailwind + shadcn/ui
skills/          # Claude Code plugin — skills, agents, hooks
```

## Development workflow

1. Create a branch from `main`
2. Make your changes
3. Run the checks (see below)
4. Open a pull request

## Code style

**Rust** — enforced by CI:
```bash
cargo fmt --check             # formatting
cargo clippy --workspace -- -D warnings  # linting
cargo test --workspace        # tests
```

**Frontend** — enforced by CI:
```bash
cd frontend
pnpm lint        # ESLint
pnpm test        # Vitest unit tests
```

**E2E** (requires backend running):
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
- `tokio-rusqlite` for async SQLite — `db.with_conn(move |conn| { ... }).await`
- Atomic task claiming with advisory locks
- CRDT sync via Yrs (Yjs Rust port) over WebSocket
- KBF for compact board serialization

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
