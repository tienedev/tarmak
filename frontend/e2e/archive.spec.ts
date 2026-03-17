import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  createTaskViaUI,
  main,
} from './helpers'

test.describe('Archive', () => {
  let boardId: string
  let columnId: string

  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'archive')
    const board = await createBoard(page, 'Archive Board')
    boardId = board.id
    const col = await createColumn(page, boardId, 'To Do')
    columnId = col.id
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
  })

  test('can archive a task from the task dialog', async ({ page }) => {
    await createTaskViaUI(page, 'Task to Archive')

    await main(page).getByText('Task to Archive').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click()

    // Task should disappear from the board
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(main(page).getByText('Task to Archive')).not.toBeVisible()
  })

  test('archived task appears in Archives panel', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Archived Item')

    // Archive via API
    const token = await page.evaluate(() => localStorage.getItem('token'))
    await page.request.post(`/api/v1/boards/${boardId}/tasks/${task.id}/archive`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    await page.reload()

    // Task should not be visible on the board
    await expect(main(page).getByText('Archived Item')).not.toBeVisible()

    // Open archives panel
    await main(page).getByText('Archives').click()
    await expect(page.getByText('Archived Item')).toBeVisible()
  })

  test('archives panel shows empty state when nothing archived', async ({ page }) => {
    await main(page).getByText('Archives').click()
    await expect(page.getByText('No archived items')).toBeVisible()
  })
})
