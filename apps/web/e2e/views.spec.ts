import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, main } from './helpers'

/** Create a column + task via API so the list view renders its table. */
async function seedTask(page: import('@playwright/test').Page, boardId: string) {
  const token = await page.evaluate(() => localStorage.getItem('token'))
  const col = await page.request.post(`/api/v1/boards/${boardId}/columns`, {
    data: { name: 'Backlog' },
    headers: { Authorization: `Bearer ${token}` },
  })
  const { id: columnId } = await col.json()
  await page.request.post(`/api/v1/boards/${boardId}/tasks`, {
    data: { title: 'Seed task', column_id: columnId },
    headers: { Authorization: `Bearer ${token}` },
  })
  await page.reload()
  await expect(main(page).getByText('Seed task')).toBeVisible()
}

test.describe('View switching', () => {
  test('default view is kanban (Board tab)', async ({ page }) => {
    await registerAndLogin(page, 'views-default')
    await createBoard(page, 'Views Board')

    await expect(main(page).getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
  })

  test('can switch to list view', async ({ page }) => {
    await registerAndLogin(page, 'views-list')
    const board = await createBoard(page, 'Views Board')
    await seedTask(page, board.id)

    await main(page).getByRole('tab', { name: 'List' }).click()

    await expect(page).toHaveURL(/view=list/)
    await expect(main(page).getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(main(page).getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(main(page).getByRole('columnheader', { name: 'Priority' })).toBeVisible()
    await expect(main(page).getByRole('columnheader', { name: 'Assignee' })).toBeVisible()
  })

  test('can switch to timeline view', async ({ page }) => {
    await registerAndLogin(page, 'views-timeline')
    await createBoard(page, 'Views Board')

    await main(page).getByRole('tab', { name: 'Timeline' }).click()

    await expect(page).toHaveURL(/view=timeline/)
  })

  test('can switch back to kanban view', async ({ page }) => {
    await registerAndLogin(page, 'views-switch')
    await createBoard(page, 'Views Board')

    await main(page).getByRole('tab', { name: 'List' }).click()
    await expect(page).toHaveURL(/view=list/)

    await main(page).getByRole('tab', { name: 'Board' }).click()
    // Kanban is the default view — URL has no ?view= param
    await expect(page).not.toHaveURL(/view=/)
    await expect(main(page).getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
  })

  test('view persists after page reload', async ({ page }) => {
    await registerAndLogin(page, 'views-persist')
    const board = await createBoard(page, 'Views Board')
    await seedTask(page, board.id)

    await main(page).getByRole('tab', { name: 'List' }).click()
    await expect(page).toHaveURL(/view=list/)

    await page.reload()

    await expect(page).toHaveURL(/view=list/)
    await expect(main(page).getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await expect(main(page).getByRole('columnheader', { name: 'Title' })).toBeVisible()
  })
})
