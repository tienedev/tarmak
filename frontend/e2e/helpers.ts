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
    email: `e2e-${prefix}-${Date.now()}@test.com`,
    password: 'testpassword123',
  }

  // Register directly via API (much faster than going through UI)
  const res = await page.request.post(`${API}/auth/register`, {
    data: user,
  })
  const auth: AuthResult = await res.json()

  // Inject the token and navigate to boards list
  await page.goto('/')
  await page.evaluate((token) => localStorage.setItem('token', token), auth.token)
  await page.reload()
  await expect(page.getByText('All Boards')).toBeVisible()

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

  // Navigate to the board
  await page.goto(`/#/boards/${board.id}`)
  await expect(page.getByText(name)).toBeVisible()

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
