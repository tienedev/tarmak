# Design: Playwright E2E + Vitest Unit Tests + CI

**Date**: 2026-03-15
**Status**: Draft
**Scope**: Add Playwright E2E tests, Vitest unit tests, and integrate both into GitHub Actions CI

## Context

The Kanwise frontend (React 19, Vite 8, TypeScript) has zero test coverage. The existing CI (`ci.yml`) has a `test-frontend` job that only runs `pnpm build`. The backend is a Rust/SQLite server listening on `:3001` with automatic migrations, a `/api/v1/health` endpoint, and serves the frontend via `rust_embed` (compile-time embedding of `frontend/dist`).

The goal is to establish a professional, solid CI pipeline with both fast unit tests and real integration E2E tests running against the actual backend.

**Important**: The backend uses `rust_embed` to embed `frontend/dist` at compile time. This means the frontend must be built **before** the backend is compiled for E2E tests. The backend serves both the API and the frontend SPA on port 3001, which is the production topology.

## Architecture

### Three parallel CI jobs

```
ci.yml
├── test-backend         (existing, unchanged)
│   └── cargo test + clippy
├── test-frontend-unit   (NEW — replaces old test-frontend)
│   └── pnpm install → pnpm test
└── test-frontend-e2e    (NEW)
    └── build frontend → build backend → start stack → playwright test
```

The existing `test-frontend` job is **removed** (replaced by `test-frontend-unit` which also validates the build implicitly via vitest). All three jobs run in parallel on every push to `main` and on PRs.

## 1. Unit Tests — Vitest

### Tools
- **vitest**: Native Vite test runner, shares the same transform pipeline
- **@testing-library/react** (v16+): DOM testing utilities (React 19 compatible)
- **@testing-library/user-event**: Recommended user interaction simulation
- **@testing-library/jest-dom**: Custom matchers (toBeInTheDocument, etc.)
- **jsdom**: Browser environment simulation

### Configuration
Vitest config lives inside `vite.config.ts` under the `test` key. A `/// <reference types="vitest" />` directive is required at the top of `vite.config.ts` to add the `test` property to Vite's `UserConfig` type:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  // ...existing config...
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

A `src/test-setup.ts` file imports `@testing-library/jest-dom/vitest` for extended matchers.

### TypeScript configuration
Test files should be excluded from `tsconfig.app.json` to avoid leaking test types into production builds. Add `"**/*.test.ts"` and `"**/*.test.tsx"` to the `exclude` array. Vitest uses its own TypeScript handling, so this does not affect test execution.

### Scripts
- `pnpm test` → `vitest run` (single run, for CI)
- `pnpm test:watch` → `vitest` (watch mode, for dev)

### Starter tests
- `src/components/ui/button.test.tsx` — Button renders with correct text and handles clicks
- `src/pages/LoginPage.test.tsx` — LoginPage renders form fields, toggles between login/register

### File convention
Test files are colocated with source: `Component.tsx` → `Component.test.tsx` in the same directory.

## 2. E2E Tests — Playwright

### Configuration
`frontend/playwright.config.ts`:

```ts
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html']] : 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

**Key decisions:**
- `baseURL` points to `localhost:3001` (the backend), which serves both the API and the embedded frontend. This matches the production topology exactly.
- Reporter uses both `list` (console output in CI logs) and `html` (detailed artifact) in CI.
- No `webServer` block — CI manages server lifecycle. For local dev, developers start backend manually.

### Test directory
`frontend/e2e/` with `.spec.ts` files.

### Starter tests
- `e2e/login.spec.ts`:
  - Login page loads and displays the form
  - User can register a new account
  - User can login after registration
  - Login redirects to boards list page

### Database isolation
Each CI run uses a fresh SQLite database via `DATABASE_PATH=/tmp/kanwise-e2e.db`. The database is created automatically by the backend's migration system on first connection.

### Browser scope
CI runs Chromium only (fast, sufficient for regression detection). Developers can add Firefox/WebKit projects locally.

## 3. CI Workflow — Modified `ci.yml`

### Job: test-frontend-unit

```yaml
test-frontend-unit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 9
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
        cache-dependency-path: frontend/pnpm-lock.yaml
    - run: cd frontend && pnpm install --frozen-lockfile
    - run: cd frontend && pnpm test
```

Expected duration: ~30 seconds.

### Job: test-frontend-e2e

**Critical: build order is frontend first, then backend** (because `rust_embed` embeds `frontend/dist` at compile time).

```yaml
test-frontend-e2e:
  runs-on: ubuntu-latest
  steps:
    # 1. Checkout
    - uses: actions/checkout@v4

    # 2. Setup Node + pnpm + build frontend FIRST
    - uses: pnpm/action-setup@v4
      with:
        version: 9
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
        cache-dependency-path: frontend/pnpm-lock.yaml
    - run: cd frontend && pnpm install --frozen-lockfile
    - run: cd frontend && pnpm build

    # 3. Setup Rust + cache + build backend (now frontend/dist has real content)
    - uses: dtolnay/rust-toolchain@stable
    - uses: Swatinem/rust-cache@v2
    - run: cargo build --release

    # 4. Cache + install Playwright browsers
    - uses: actions/cache@v4
      with:
        path: ~/.cache/ms-playwright
        key: playwright-${{ hashFiles('frontend/pnpm-lock.yaml') }}
    - run: cd frontend && npx playwright install --with-deps chromium

    # 5. Start backend + wait for health
    - run: DATABASE_PATH=/tmp/kanwise-e2e.db ./target/release/kanwise &
    - run: timeout 30 bash -c 'until curl -sf http://localhost:3001/api/v1/health; do sleep 1; done'

    # 6. Run E2E tests
    - run: cd frontend && npx playwright test
      env:
        CI: true

    # 7. Upload report (always, even on failure)
    - uses: actions/upload-artifact@v4
      if: ${{ !cancelled() }}
      with:
        name: playwright-report
        path: frontend/playwright-report/
        retention-days: 7
```

### Caching strategy
- **Rust**: `Swatinem/rust-cache@v2` (caches target/ and registry)
- **pnpm**: `actions/setup-node` built-in cache
- **Playwright browsers**: explicit `actions/cache@v4` on `~/.cache/ms-playwright`, keyed on lockfile hash

### Removed job: test-frontend
The old `test-frontend` job (which only ran `pnpm build`) is removed. The build is now covered by `test-frontend-e2e`, and `test-frontend-unit` validates code correctness.

### Existing job: test-backend
Unchanged. Continues to run `cargo test --workspace` and `cargo clippy`.

## 4. Files Added/Modified

| File | Action | Purpose |
|------|--------|---------|
| `frontend/package.json` | Modified | Add vitest, testing-library, playwright devDeps + test scripts |
| `frontend/vite.config.ts` | Modified | Add `/// <reference types="vitest" />` + `test` config section |
| `frontend/tsconfig.app.json` | Modified | Exclude test files from production build |
| `frontend/src/test-setup.ts` | New | Testing-library matchers setup |
| `frontend/src/components/ui/button.test.tsx` | New | Starter unit test |
| `frontend/src/pages/LoginPage.test.tsx` | New | Starter unit test |
| `frontend/playwright.config.ts` | New | Playwright configuration |
| `frontend/e2e/login.spec.ts` | New | Starter E2E test |
| `.github/workflows/ci.yml` | Modified | Remove old test-frontend, add 2 new jobs |
| `frontend/.gitignore` | Modified | Add test-results/, playwright-report/ |

## 5. Decisions and trade-offs

| Decision | Rationale |
|----------|-----------|
| Vitest over Jest | Native Vite integration, same transform pipeline, faster |
| Colocated tests over `__tests__/` dirs | Easier to find, standard React convention |
| Chromium-only in CI | Sufficient for regression detection, saves ~3min per run |
| Real backend in E2E (no mocks) | Solid integration testing, catches real bugs |
| baseURL = localhost:3001 | Backend serves embedded frontend via rust_embed — matches production topology |
| Build frontend before backend in E2E | rust_embed embeds frontend/dist at compile time |
| No Playwright `webServer` config | CI manages server lifecycle; avoids coupling Playwright to build commands |
| Fresh SQLite per E2E run | Isolation, no state leakage between runs, automatic via migrations |
| Dual reporter (list + html) in CI | Console output for quick feedback + HTML artifact for detailed debugging |
| Explicit Playwright browser cache | Browser binaries (~150MB) cached separately from pnpm store |
| @testing-library/user-event included | Recommended over fireEvent for realistic user interaction simulation |
| vitest triple-slash reference | Required for TypeScript to recognize the `test` key in vite.config.ts |
