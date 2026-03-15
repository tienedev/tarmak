# Playwright E2E + Vitest Unit Tests + CI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vitest unit tests, Playwright E2E tests, and integrate both into GitHub Actions CI with real backend integration.

**Architecture:** Three parallel CI jobs: `test-backend` (existing), `test-frontend-unit` (Vitest), `test-frontend-e2e` (Playwright against real Rust/SQLite backend). The E2E job builds the frontend first (required by rust_embed compile-time embedding), then the backend, starts the server on :3001, and runs Playwright against it.

**Tech Stack:** Vitest, @testing-library/react, @testing-library/user-event, jsdom, Playwright, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-15-playwright-vitest-ci-design.md`

---

## Chunk 1: Vitest Setup & Unit Tests

### Task 1: Install Vitest dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install vitest and testing-library packages**

Run from `frontend/`:
```bash
pnpm add -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Add test scripts to package.json**

In `frontend/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: add vitest and testing-library dependencies"
```

---

### Task 2: Configure Vitest

**Files:**
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test-setup.ts`
- Modify: `frontend/tsconfig.app.json`

- [ ] **Step 1: Add vitest config to vite.config.ts**

Add `/// <reference types="vitest" />` at line 1, then add the `test` key to the config:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 2: Create test-setup.ts**

Create `frontend/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: Exclude test files from tsconfig.app.json**

In `frontend/tsconfig.app.json`, add an `exclude` array:
```json
{
  "compilerOptions": { ... },
  "include": ["src"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx", "src/test-setup.ts"]
}
```

- [ ] **Step 4: Verify vitest runs (no tests yet, should exit cleanly)**

Run: `cd frontend && pnpm test`
Expected: exits with 0, "no test files found" or similar

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts frontend/src/test-setup.ts frontend/tsconfig.app.json
git commit -m "chore: configure vitest with jsdom and testing-library"
```

---

### Task 3: Write Button unit test

**Files:**
- Create: `frontend/src/components/ui/button.test.tsx`

- [ ] **Step 1: Write the test**

Create `frontend/src/components/ui/button.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('renders with text content', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    await user.click(screen.getByRole('button', { name: 'Click' }))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && pnpm test`
Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/button.test.tsx
git commit -m "test: add Button component unit tests"
```

---

### Task 4: Write LoginPage unit test

**Files:**
- Create: `frontend/src/pages/LoginPage.test.tsx`

The LoginPage uses `useAuthStore` which makes API calls. We need to mock the store for unit tests.

- [ ] **Step 1: Write the test**

Create `frontend/src/pages/LoginPage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    login: vi.fn(),
    register: vi.fn(),
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the login form by default', () => {
    render(<LoginPage />)
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('toggles to register form', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByText('Create one'))
    expect(screen.getByText('Create an account')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('toggles back to login form', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByText('Create one'))
    await user.click(screen.getByText('Sign in'))
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && pnpm test`
Expected: all tests PASS (Button + LoginPage)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.test.tsx
git commit -m "test: add LoginPage unit tests"
```

---

## Chunk 2: Playwright Setup & E2E Tests

### Task 5: Install Playwright

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install Playwright**

Run from `frontend/`:
```bash
pnpm add -D @playwright/test
```

- [ ] **Step 2: Install Chromium browser**

```bash
cd frontend && npx playwright install chromium
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: add Playwright dependency"
```

---

### Task 6: Configure Playwright

**Files:**
- Create: `frontend/playwright.config.ts`
- Modify: `frontend/.gitignore`

- [ ] **Step 1: Create playwright.config.ts**

Create `frontend/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

- [ ] **Step 2: Update .gitignore**

Append to `frontend/.gitignore`:
```
# Playwright
test-results/
playwright-report/
blob-report/
playwright/.cache/
```

- [ ] **Step 3: Create e2e directory**

```bash
mkdir -p frontend/e2e
```

- [ ] **Step 4: Commit**

```bash
git add frontend/playwright.config.ts frontend/.gitignore
git commit -m "chore: configure Playwright with Chromium project"
```

---

### Task 7: Write login E2E test

**Files:**
- Create: `frontend/e2e/login.spec.ts`

These tests run against the real backend on `:3001`. The backend serves the frontend SPA via `rust_embed` and handles API requests. The app uses hash-based routing (`#/login`, `#/`, `#/boards/:id`).

- [ ] **Step 1: Write the E2E test**

Create `frontend/e2e/login.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e-${Date.now()}@test.com`,
  password: 'testpassword123',
}

test.describe('Login flow', () => {
  test('login page loads and displays the form', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('user can register, then login', async ({ page }) => {
    await page.goto('/')

    // Switch to register form
    await page.getByText('Create one').click()
    await expect(page.getByText('Create an account')).toBeVisible()

    // Fill in registration form
    await page.getByLabel('Name').fill(TEST_USER.name)
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Should redirect to boards list (hash router: #/ or empty)
    await expect(page).toHaveURL(/\/#?\/?$/)

    // Logout by clearing localStorage and reloading
    await page.evaluate(() => localStorage.removeItem('token'))
    await page.reload()

    // Should be back on login
    await expect(page.getByText('Welcome back')).toBeVisible()

    // Login with the registered account
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should redirect to boards list again
    await expect(page).toHaveURL(/\/#?\/?$/)
  })
})
```

- [ ] **Step 2: Run E2E test locally (requires backend running)**

Start backend first (in another terminal):
```bash
DATABASE_PATH=/tmp/kanwise-e2e-local.db cargo run
```

Then run:
```bash
cd frontend && npx playwright test
```

Expected: 2 tests PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/login.spec.ts
git commit -m "test: add login flow E2E tests"
```

---

## Chunk 3: CI Integration

### Task 8: Update ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the CI workflow**

Replace the entire `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: mkdir -p frontend/dist && echo '<!DOCTYPE html><html><body></body></html>' > frontend/dist/index.html
      - run: cargo test --workspace
      - run: cargo clippy --workspace -- -D warnings

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

  test-frontend-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Build frontend FIRST (rust_embed embeds frontend/dist at compile time)
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

      # Build backend (now frontend/dist has real content)
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo build --release

      # Install Playwright browsers
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ hashFiles('frontend/pnpm-lock.yaml') }}
      - run: cd frontend && npx playwright install --with-deps chromium

      # Start backend and wait for health
      - run: DATABASE_PATH=/tmp/kanwise-e2e.db ./target/release/kanwise &
      - run: timeout 30 bash -c 'until curl -sf http://localhost:3001/api/v1/health; do sleep 1; done'

      # Run E2E tests
      - run: cd frontend && npx playwright test
        env:
          CI: true

      # Upload report (always, even on failure)
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Verify YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML valid"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add unit test and E2E test jobs, remove old test-frontend"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run unit tests**

```bash
cd frontend && pnpm test
```

Expected: all tests PASS

- [ ] **Step 2: Run E2E tests locally (if backend available)**

```bash
DATABASE_PATH=/tmp/kanwise-e2e-verify.db cargo run &
sleep 3
cd frontend && npx playwright test
```

Expected: all tests PASS

- [ ] **Step 3: Verify build still works**

```bash
cd frontend && pnpm build
```

Expected: build succeeds

- [ ] **Step 4: Final commit if any adjustments needed**

Only if fixes were required in the verification steps.
