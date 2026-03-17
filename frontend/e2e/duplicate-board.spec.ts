import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  createLabel,
  addTaskLabel,
  createSubtask,
  main,
} from './helpers'

test.describe('Duplicate board', () => {
  test('duplicate board button opens dialog', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-btn')
    await createBoard(page, 'Source Board')

    await main(page).getByRole('button', { name: /duplicate board/i }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Duplicate board')).toBeVisible()
    // Name should be pre-filled
    await expect(page.getByRole('dialog').locator('input[type="text"]')).toHaveValue(
      'Copy of Source Board',
    )
  })

  test('can duplicate a board and navigate to it', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-nav')
    const board = await createBoard(page, 'Navigate Board')
    await createColumn(page, board.id, 'Backlog')
    await page.reload()

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Change the name
    const nameInput = page.getByRole('dialog').locator('input[type="text"]')
    await nameInput.clear()
    await nameInput.fill('Cloned Board')

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    // Should navigate to the new board
    await expect(main(page).getByRole('heading', { name: 'Cloned Board' })).toBeVisible()

    // The new board should have the same column structure
    await expect(main(page).getByText('Backlog')).toBeVisible()
  })

  test('duplicate board with tasks copies tasks', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-tasks')
    const board = await createBoard(page, 'Tasks Board')
    const col = await createColumn(page, board.id, 'To Do')
    await createTask(page, board.id, col.id, 'Task Alpha')
    await createTask(page, board.id, col.id, 'Task Beta')
    await page.reload()
    await expect(main(page).getByText('Task Alpha')).toBeVisible()

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Include tasks is checked by default
    const checkbox = page.getByRole('dialog').locator('input[type="checkbox"]')
    await expect(checkbox).toBeChecked()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    // Wait for navigation to new board
    await expect(main(page).getByRole('heading', { name: 'Copy of Tasks Board' })).toBeVisible()

    // Tasks should be copied
    await expect(main(page).getByText('Task Alpha')).toBeVisible()
    await expect(main(page).getByText('Task Beta')).toBeVisible()
  })

  test('duplicate board without tasks copies only structure', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-notasks')
    const board = await createBoard(page, 'Structure Board')
    const col = await createColumn(page, board.id, 'In Progress')
    await createTask(page, board.id, col.id, 'A task')
    await page.reload()
    await expect(main(page).getByText('A task')).toBeVisible()

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Uncheck "Include tasks"
    const checkbox = page.getByRole('dialog').locator('input[type="checkbox"]')
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()

    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    // New board has the column but no tasks
    await expect(main(page).getByRole('heading', { name: 'Copy of Structure Board' })).toBeVisible()
    await expect(main(page).getByText('In Progress')).toBeVisible()
    await expect(main(page).getByText('A task')).not.toBeVisible()
  })

  test('duplicate board copies labels', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-labels')
    const board = await createBoard(page, 'Labels Board')
    await createLabel(page, board.id, 'Feature', '#3b82f6')
    await createLabel(page, board.id, 'Urgent', '#ef4444')

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    // Navigate to the new board's settings to check labels
    await expect(main(page).getByRole('heading', { name: 'Copy of Labels Board' })).toBeVisible()
    await main(page).getByRole('button', { name: /board settings/i }).click()
    await expect(page.getByRole('heading', { name: 'Board Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Labels' }).click()

    await expect(page.getByText('Feature')).toBeVisible()
    await expect(page.getByText('Urgent')).toBeVisible()
  })

  test('duplicate board with tasks preserves task labels', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-tlabels')
    const board = await createBoard(page, 'TLabel Board')
    const col = await createColumn(page, board.id, 'Backlog')
    const task = await createTask(page, board.id, col.id, 'Tagged Task')
    const label = await createLabel(page, board.id, 'Critical', '#ef4444')
    await addTaskLabel(page, board.id, task.id, label.id)

    await page.reload()
    await expect(main(page).getByText('Tagged Task')).toBeVisible()

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    await expect(main(page).getByRole('heading', { name: 'Copy of TLabel Board' })).toBeVisible()

    // Open the task to verify the label is present
    await main(page).getByText('Tagged Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Critical')).toBeVisible()
  })

  test('duplicated board appears in sidebar', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-sidebar')
    await createBoard(page, 'Sidebar Board')

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate' }).click()

    await expect(main(page).getByRole('heading', { name: 'Copy of Sidebar Board' })).toBeVisible()

    // Both boards should be visible in the sidebar
    await expect(page.getByRole('link', { name: 'Sidebar Board' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Copy of Sidebar Board' })).toBeVisible()
  })

  test('cancel button closes the duplicate dialog', async ({ page }) => {
    await registerAndLogin(page, 'dup-board-cancel')
    await createBoard(page, 'Cancel Board')

    await main(page).getByRole('button', { name: /duplicate board/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    // Still on the same board
    await expect(main(page).getByRole('heading', { name: 'Cancel Board' })).toBeVisible()
  })
})
