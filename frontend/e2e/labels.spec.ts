import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

test.describe('Labels', () => {
  test('can create a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels')
    await createBoard(page, 'Labels Board')

    // Open LabelManager popover
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()

    // Fill in label name, pick a color, and add
    await page.getByPlaceholder('New label...').fill('Bug')
    // Click a color swatch (second one — orange)
    await page.locator('button[style*="background-color"]').nth(1).click()
    // Submit via Enter
    await page.getByPlaceholder('New label...').press('Enter')

    // Verify the label appears in the popover list
    await expect(page.getByText('Bug')).toBeVisible()
  })

  test('can edit a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels')
    await createBoard(page, 'Labels Board')

    // Open LabelManager and create a label
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('Feature')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('Feature')).toBeVisible()

    // Hover the label row to reveal edit/delete buttons
    const labelRow = page.locator('.group').filter({ hasText: 'Feature' })
    await labelRow.hover()

    // Click the edit (Pencil) button
    await labelRow.locator('button').first().click()

    // Edit the name
    const editInput = labelRow.getByRole('textbox')
    await editInput.clear()
    await editInput.fill('Enhancement')
    await page.getByRole('button', { name: 'Save' }).click()

    // Verify updated name
    await expect(page.getByText('Enhancement')).toBeVisible()
    await expect(page.getByText('Feature')).not.toBeVisible()
  })

  test('can delete a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels')
    await createBoard(page, 'Labels Board')

    // Open LabelManager and create a label
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('ToDelete')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('ToDelete')).toBeVisible()

    // Hover the label row and click delete (Trash2) button
    const labelRow = page.locator('.group').filter({ hasText: 'ToDelete' })
    await labelRow.hover()
    await labelRow.locator('button').nth(1).click()

    // Verify label is removed
    await expect(page.getByText('ToDelete')).not.toBeVisible()
  })

  test('can assign a label to a task', async ({ page }) => {
    await registerAndLogin(page, 'labels')
    await createBoard(page, 'Labels Board')

    // Create a board label
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('Critical')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('Critical')).toBeVisible()
    await page.keyboard.press('Escape')

    // Create a column
    await page.getByText('Add column').click()
    await page.getByPlaceholder('Column name...').fill('To Do')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('To Do')).toBeVisible()

    // Create a task
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('My Task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('My Task')).toBeVisible()

    // Open the task dialog
    await page.getByText('My Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Open label picker and toggle "Critical" on
    await page.getByText('Add labels...').click()
    const labelOption = page.getByRole('button').filter({ hasText: 'Critical' }).last()
    await expect(labelOption).toBeVisible()
    await labelOption.click()

    // Close popovers and dialog
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Verify the label pill is visible on the task card
    await expect(page.getByText('Critical')).toBeVisible()
  })
})
