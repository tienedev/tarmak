import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn } from './helpers'

let boardId: string

test.describe('Task lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'task')
    const board = await createBoard(page, 'Task Board')
    boardId = board.id

    // Create a column via API, then reload to see it
    await createColumn(page, boardId, 'To Do')
    await page.reload()
    await expect(page.getByText('To Do')).toBeVisible()
  })

  test('can create a task in a column', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('My first task')
    await page.getByRole('button', { name: 'Add' }).click()

    await expect(page.getByText('My first task')).toBeVisible()
  })

  test('can create a task with priority', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('High priority task')

    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'High' }).click()

    await page.getByRole('button', { name: 'Add' }).click()

    await expect(page.getByText('High priority task')).toBeVisible()
    await expect(page.getByText('High', { exact: true })).toBeVisible()
  })

  test('can open task detail dialog', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Dialog task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Dialog task')).toBeVisible()

    await page.getByText('Dialog task').click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Dialog task')).toBeVisible()
  })

  test('can edit task title', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Original title')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Original title')).toBeVisible()

    await page.getByText('Original title').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Click title to switch to edit mode
    await page.getByRole('dialog').getByText('Original title').click()
    const titleInput = page.getByRole('dialog').locator('input').first()
    await titleInput.fill('Updated title')
    await titleInput.press('Enter')

    await expect(page.getByRole('dialog').getByText('Updated title')).toBeVisible()
  })

  test('can edit task priority', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Priority edit task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Priority edit task')).toBeVisible()

    await page.getByText('Priority edit task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByText('None', { exact: true }).click()
    await page.getByRole('option', { name: 'Urgent' }).click()

    await expect(page.getByRole('dialog').getByText('Urgent')).toBeVisible()
  })

  test('can delete a task', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Task to delete')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Task to delete')).toBeVisible()

    await page.getByText('Task to delete').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('Task to delete')).toBeHidden()
  })
})
