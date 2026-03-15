import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

test.describe('Task lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'task')
    await createBoard(page, 'Task Board')

    // Add a column to the empty board
    await page.getByText('Add column').click()
    await page.getByPlaceholder('Column name...').fill('To Do')
    await page.getByRole('button', { name: 'Add' }).click()

    // Wait for the column to appear
    await expect(page.getByText('To Do')).toBeVisible()
  })

  test('can create a task in a column', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('My first task')
    await page.getByRole('button', { name: 'Add' }).click()

    // Verify task card appears in the column
    await expect(page.getByText('My first task')).toBeVisible()
  })

  test('can create a task with priority', async ({ page }) => {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('High priority task')

    // Open priority select and choose High
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'High' }).click()

    await page.getByRole('button', { name: 'Add' }).click()

    // Verify task card appears with priority badge
    await expect(page.getByText('High priority task')).toBeVisible()
    await expect(page.getByText('High', { exact: true })).toBeVisible()
  })

  test('can open task detail dialog', async ({ page }) => {
    // Create a task first
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Dialog task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Dialog task')).toBeVisible()

    // Click on the task card to open the dialog
    await page.getByText('Dialog task').click()

    // Verify the dialog is open with task title visible
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Dialog task')).toBeVisible()
  })

  test('can edit task title', async ({ page }) => {
    // Create a task
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Original title')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Original title')).toBeVisible()

    // Open task dialog
    await page.getByText('Original title').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Click on the title to edit it (the title is rendered as a button that toggles to an input)
    await page.getByRole('dialog').getByText('Original title').click()

    // Clear and type the new title
    const titleInput = page.getByRole('dialog').locator('input').first()
    await titleInput.fill('Updated title')
    await titleInput.press('Enter')

    // Verify the updated title is shown in the dialog
    await expect(page.getByRole('dialog').getByText('Updated title')).toBeVisible()
  })

  test('can edit task priority', async ({ page }) => {
    // Create a task
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Priority edit task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Priority edit task')).toBeVisible()

    // Open task dialog
    await page.getByText('Priority edit task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Change priority using the priority select in the editor
    // The priority row shows "None" by default - click the trigger to open the select
    await page.getByRole('dialog').getByText('None', { exact: true }).click()
    await page.getByRole('option', { name: 'Urgent' }).click()

    // Verify the new priority is displayed
    await expect(page.getByRole('dialog').getByText('Urgent')).toBeVisible()
  })

  test('can delete a task', async ({ page }) => {
    // Create a task
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('Task to delete')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Task to delete')).toBeVisible()

    // Open task dialog
    await page.getByText('Task to delete').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Click Delete and confirm the browser dialog
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).click()

    // Verify task is removed from the column
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('Task to delete')).toBeHidden()
    await expect(page.getByText('No tasks yet')).toBeVisible()
  })
})
