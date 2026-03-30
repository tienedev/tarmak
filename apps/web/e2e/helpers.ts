import { type Page, expect } from '@playwright/test'

const API = '/api/v1'

interface AuthResult {
  token: string
  user: { id: string; name: string; email: string }
}

/** Call a tRPC mutation via HTTP batch protocol (tRPC v11). */
async function trpc<T>(
  page: Page,
  procedure: string,
  input: unknown,
  token: string,
): Promise<T> {
  const res = await page.request.post(`/trpc/${procedure}?batch=1`, {
    data: [{ json: input }],
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok()) {
    throw new Error(`tRPC ${procedure} failed: ${res.status()} ${await res.text()}`)
  }
  const body = await res.json()
  return body[0].result.data.json as T
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

/** Get auth token from localStorage. */
export async function getToken(page: Page): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem('token')))!
}

/** Create a board via tRPC and navigate into it. */
export async function createBoard(page: Page, name: string, description?: string) {
  const token = await getToken(page)
  const board = await trpc<{ id: string }>(page, 'board.create', { name, description }, token)

  await page.goto(`/#/boards/${board.id}`)
  await expect(page.getByRole('main').getByRole('heading', { name })).toBeVisible()

  return board
}

/** Create a column via tRPC. */
export async function createColumn(page: Page, boardId: string, name: string, color?: string) {
  const token = await getToken(page)
  return trpc<{ id: string }>(page, 'column.create', { boardId, name, color }, token)
}

/** Create a task via tRPC. Returns task with id. */
export async function createTask(
  page: Page,
  boardId: string,
  columnId: string,
  title: string,
  priority?: string,
) {
  const token = await getToken(page)
  return trpc<{ id: string; title: string }>(
    page,
    'task.create',
    { boardId, columnId, title, priority: priority ?? 'medium' },
    token,
  )
}

/** Create a label via tRPC. Returns label with id. */
export async function createLabel(page: Page, boardId: string, name: string, color: string) {
  const token = await getToken(page)
  return trpc<{ id: string; name: string }>(page, 'label.create', { boardId, name, color }, token)
}

/** Assign a label to a task via tRPC. */
export async function addTaskLabel(
  page: Page,
  _boardId: string,
  taskId: string,
  labelId: string,
) {
  const token = await getToken(page)
  await trpc(page, 'label.addToTask', { taskId, labelId }, token)
}

/** Create a subtask via tRPC. */
export async function createSubtask(page: Page, _boardId: string, taskId: string, title: string) {
  const token = await getToken(page)
  return trpc<{ id: string; title: string }>(page, 'subtask.create', { taskId, title }, token)
}

/** Create a task via UI (requires being on a board page with a column). */
export async function createTaskViaUI(page: Page, title: string) {
  await main(page).getByRole('button', { name: 'Add task' }).click()
  await page.getByPlaceholder('Task title...').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(main(page).getByText(title)).toBeVisible()
}

/** Scope selector helper — returns the main content area. */
export function main(page: Page) {
  return page.getByRole('main')
}

/** Returns the sidebar board button locator for a given board name. */
export function sidebarBoard(page: Page, name: string) {
  return page.locator('aside, [data-slot="sheet-content"]').getByRole('button', { name })
}
