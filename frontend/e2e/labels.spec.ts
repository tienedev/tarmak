import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn } from './helpers'

test.describe('Labels', () => {
  test('can create a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-create')
    await createBoard(page, 'Labels Board')

    // Open LabelManager popover
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()

    // Fill name, pick color, submit
    await page.getByPlaceholder('New label...').fill('Bug')
    await page.locator('button[style*="background-color"]').nth(1).click()
    await page.getByPlaceholder('New label...').press('Enter')

    await expect(page.getByText('Bug')).toBeVisible()
  })

  test('can edit a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-edit')
    await createBoard(page, 'Labels Board')

    // Create a label
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('Feature')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('Feature')).toBeVisible()

    // Hover and click edit
    const labelRow = page.locator('.group').filter({ hasText: 'Feature' })
    await labelRow.hover()
    await labelRow.locator('button').first().click()

    // Change name and save
    const editInput = labelRow.getByRole('textbox')
    await editInput.clear()
    await editInput.fill('Enhancement')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Enhancement')).toBeVisible()
    await expect(page.getByText('Feature')).not.toBeVisible()
  })

  test('can delete a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-delete')
    await createBoard(page, 'Labels Board')

    // Create a label
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('ToDelete')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('ToDelete')).toBeVisible()

    // Hover and click delete
    const labelRow = page.locator('.group').filter({ hasText: 'ToDelete' })
    await labelRow.hover()
    await labelRow.locator('button').nth(1).click()

    await expect(page.getByText('ToDelete')).not.toBeVisible()
  })

  test('can assign a label to a task', async ({ page }) => {
    await registerAndLogin(page, 'labels-assign')
    const board = await createBoard(page, 'Labels Board')

    // Create label via UI
    await page.getByLabel('Labels').click()
    await expect(page.getByText('Board Labels')).toBeVisible()
    await page.getByPlaceholder('New label...').fill('Critical')
    await page.getByPlaceholder('New label...').press('Enter')
    await expect(page.getByText('Critical')).toBeVisible()
    await page.keyboard.press('Escape')

    // Create column via API, reload
    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(page.getByText('To Do')).toBeVisible()

    // Create a task via UI
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill('My Task')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('My Task')).toBeVisible()

    // Open task dialog and assign label
    await page.getByText('My Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByText('Add labels...').click()
    const labelOption = page.getByRole('button').filter({ hasText: 'Critical' }).last()
    await labelOption.click()

    // Close popovers
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Verify label on task card
    await expect(page.getByText('Critical')).toBeVisible()
  })
})
