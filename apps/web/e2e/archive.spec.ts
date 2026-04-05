import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  createTaskViaUI,
  archiveTask,
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

    // The Archive button is in the task dialog footer — use exact match
    await page.getByRole('dialog').getByRole('button', { name: 'Archive', exact: true }).click()

    // Task should disappear from the board
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(main(page).getByText('Task to Archive')).not.toBeVisible()
  })

  test('archived task appears in Archives panel', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Archived Item')

    // Archive via tRPC
    await archiveTask(page, boardId, task.id)
    await page.reload()

    // Task should not be visible on the board
    await expect(main(page).getByText('Archived Item')).not.toBeVisible()

    // Open archives panel via header button
    await main(page).getByRole('button', { name: 'Archives' }).click()
    await expect(page.locator('[role="dialog"]').getByText('Archived Item')).toBeVisible()
  })

  test('archives panel shows empty state when nothing archived', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Archives' }).click()
    await expect(page.locator('[role="dialog"]').getByText('No archived items')).toBeVisible()
  })
})
