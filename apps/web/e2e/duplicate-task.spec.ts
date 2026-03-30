import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  updateTask,
  createLabel,
  addTaskLabel,
  createSubtask,
  main,
} from './helpers'

test.describe('Duplicate task', () => {
  let boardId: string
  let columnId: string

  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'dup-task')
    const board = await createBoard(page, 'Dup Task Board')
    boardId = board.id
    const col = await createColumn(page, boardId, 'To Do')
    columnId = col.id
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
  })

  test('duplicate button is visible in task dialog footer', async ({ page }) => {
    await createTask(page, boardId, columnId, 'My Task')
    await page.reload()
    await main(page).getByText('My Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }),
    ).toBeVisible()
  })

  test('duplicating a task creates a "Copy of" task in the same column', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Original Task')
    await page.reload()
    await main(page).getByText('Original Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    // Dialog should close
    await expect(page.getByRole('dialog')).toBeHidden()

    // "Copy of Original Task" should appear in the board
    await expect(main(page).getByText('Copy of Original Task')).toBeVisible()
    // Original should still be there
    await expect(main(page).getByText('Original Task').first()).toBeVisible()
  })

  test('duplicated task preserves labels', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Labeled Task')
    const label = await createLabel(page, boardId, 'Bug', '#ef4444')
    await addTaskLabel(page, boardId, task.id, label.id)

    await page.reload()
    await main(page).getByText('Labeled Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // Open the duplicated task
    await main(page).getByText('Copy of Labeled Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // The "Bug" label should be present on the duplicated task
    await expect(page.getByRole('dialog').getByText('Bug')).toBeVisible()
  })

  test('duplicated task has subtasks reset to uncompleted', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Subtask Task')
    await createSubtask(page, boardId, task.id, 'Step 1')
    await createSubtask(page, boardId, task.id, 'Step 2')

    await page.reload()
    await main(page).getByText('Subtask Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // Open the duplicated task
    await main(page).getByText('Copy of Subtask Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Expand subtasks section
    await page.getByRole('dialog').getByText('Subtasks').click()
    await expect(page.getByRole('dialog').getByText('Step 1')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Step 2')).toBeVisible()

    // Both subtasks should have unchecked checkboxes (0/2)
    await expect(page.getByRole('dialog').getByText('(0/2)')).toBeVisible()
  })

  test('duplicated task clears assignee and due date', async ({ page }) => {
    // Create a task and set assignee + due date via tRPC
    const task = await createTask(page, boardId, columnId, 'Full Task')
    await updateTask(page, task.id, { assignee: 'someone', due_date: '2026-12-31' })

    await page.reload()
    await main(page).getByText('Full Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // Open the duplicated task
    await main(page).getByText('Copy of Full Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Assignee and due date should not be set
    await expect(page.getByRole('dialog').getByText('someone')).not.toBeVisible()
    await expect(page.getByRole('dialog').getByText('2026-12-31')).not.toBeVisible()
  })
})
