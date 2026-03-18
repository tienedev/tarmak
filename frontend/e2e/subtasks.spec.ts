import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  createSubtask,
  main,
} from './helpers'

test.describe('Subtasks', () => {
  let boardId: string
  let columnId: string

  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'subtask')
    const board = await createBoard(page, 'Subtask Board')
    boardId = board.id
    const col = await createColumn(page, boardId, 'To Do')
    columnId = col.id
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
  })

  test('subtasks section is collapsed by default', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Task with subtasks')
    await page.reload()
    await main(page).getByText('Task with subtasks').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // "Subtasks" button should be visible (collapsed header)
    await expect(page.getByRole('dialog').getByRole('button', { name: /Subtasks/ })).toBeVisible()
    // Subtask input should not be visible when collapsed
    await expect(page.getByRole('dialog').getByPlaceholder('Add subtask...')).not.toBeVisible()
  })

  test('can expand subtasks section', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Expandable Task')
    await page.reload()
    await main(page).getByText('Expandable Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: /Subtasks/ }).click()
    await expect(page.getByRole('dialog').getByPlaceholder('Add subtask...')).toBeVisible()
  })

  test('can add a subtask via UI', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Add Sub Task')
    await page.reload()
    await main(page).getByText('Add Sub Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Expand subtasks
    await page.getByRole('dialog').getByRole('button', { name: /Subtasks/ }).click()
    await page.getByRole('dialog').getByPlaceholder('Add subtask...').fill('First subtask')
    await page.getByRole('dialog').getByPlaceholder('Add subtask...').press('Enter')

    await expect(page.getByRole('dialog').getByText('First subtask')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('(0/1)')).toBeVisible()
  })

  test('can toggle subtask completion', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Toggle Task')
    await createSubtask(page, boardId, task.id, 'Check me')
    await page.reload()

    await main(page).getByText('Toggle Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: /Subtasks/ }).click()
    await expect(page.getByRole('dialog').getByText('(0/1)')).toBeVisible()

    // Toggle the checkbox
    await page.getByRole('dialog').getByRole('checkbox').check()

    await expect(page.getByRole('dialog').getByText('(1/1)')).toBeVisible()
  })

  test('subtask count shows on API-created subtasks', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Count Task')
    await createSubtask(page, boardId, task.id, 'Sub A')
    await createSubtask(page, boardId, task.id, 'Sub B')
    await createSubtask(page, boardId, task.id, 'Sub C')
    await page.reload()

    await main(page).getByText('Count Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Expand and verify
    await page.getByRole('dialog').getByRole('button', { name: /Subtasks/ }).click()
    await expect(page.getByRole('dialog').getByText('(0/3)')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Sub A')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Sub B')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Sub C')).toBeVisible()
  })
})
