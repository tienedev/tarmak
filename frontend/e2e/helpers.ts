import { type Page, expect } from '@playwright/test'

const API = '/api/v1'

interface AuthResult {
  token: string
  user: { id: string; name: string; email: string }
}

/** Register a user via API and inject the token into the browser. */
export async function registerAndLogin(page: Page, prefix: string) {
  const user = {
    name: `E2E ${prefix}`,
    email: `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
    password: 'testpassword123',
  }

  // Retry registration if rate-limited (10 req/60s per IP)
  let res: Awaited<ReturnType<typeof page.request.post>>
  for (let attempt = 0; attempt < 40; attempt++) {
    res = await page.request.post(`${API}/auth/register`, { data: user })
    if (res.ok()) break
    await page.waitForTimeout(2000)
  }
  if (!res!.ok()) {
    throw new Error(`Registration failed after retries: ${res!.status()} ${await res!.text()}`)
  }
  const auth: AuthResult = await res!.json()

  await page.goto('/')
  await page.evaluate((token) => localStorage.setItem('token', token), auth.token)
  await page.reload()
  await expect(page.getByRole('main').getByText('Dashboard')).toBeVisible()

  return user
}

/** Create a board via API and navigate into it. */
export async function createBoard(page: Page, name: string, description?: string) {
  const res = await page.request.post(`${API}/boards`, {
    data: { name, description },
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}`,
    },
  })
  const board: { id: string } = await res.json()

  await page.goto(`/#/boards/${board.id}`)
  await expect(page.getByRole('main').getByRole('heading', { name })).toBeVisible()

  return board
}

/** Create a column via API. */
export async function createColumn(page: Page, boardId: string, name: string, color?: string) {
  const res = await page.request.post(`${API}/boards/${boardId}/columns`, {
    data: { name, color },
    headers: {
      Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}`,
    },
  })
  return (await res.json()) as { id: string }
}

/** Scope selector helper — returns the main content area. */
export function main(page: Page) {
  return page.getByRole('main')
}
