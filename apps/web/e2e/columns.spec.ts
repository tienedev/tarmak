import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  main,
} from './helpers'

test.describe('Column management', () => {
  test('can add a column to a board', async ({ page }) => {
    await registerAndLogin(page, 'col-add')
    const board = await createBoard(page, 'Columns Board')
    await createColumn(page, board.id, 'Backlog')
    await page.reload()

    await expect(main(page).getByText('Backlog')).toBeVisible()
  })

  test('multiple columns render in order', async ({ page }) => {
    await registerAndLogin(page, 'col-order')
    const board = await createBoard(page, 'Multi Col Board')
    await createColumn(page, board.id, 'To Do')
    await createColumn(page, board.id, 'In Progress')
    await createColumn(page, board.id, 'Done')
    await page.reload()

    await expect(main(page).getByText('To Do')).toBeVisible()
    await expect(main(page).getByText('In Progress')).toBeVisible()
    await expect(main(page).getByText('Done')).toBeVisible()
  })

  test('tasks appear in their assigned column', async ({ page }) => {
    await registerAndLogin(page, 'col-tasks')
    const board = await createBoard(page, 'Task Col Board')
    const col1 = await createColumn(page, board.id, 'Backlog')
    const col2 = await createColumn(page, board.id, 'Active')
    await createTask(page, board.id, col1.id, 'Backlog Task')
    await createTask(page, board.id, col2.id, 'Active Task')
    await page.reload()

    await expect(main(page).getByText('Backlog Task')).toBeVisible()
    await expect(main(page).getByText('Active Task')).toBeVisible()
  })
})
