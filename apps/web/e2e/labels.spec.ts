import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn, createLabel, main } from './helpers'

/** Open the Board Settings panel and navigate to the Labels tab */
async function openLabelsSettings(page: import('@playwright/test').Page) {
  await main(page).getByRole('button', { name: /board settings/i }).click()
  await expect(page.getByRole('heading', { name: 'Board Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Labels' }).click()
}

test.describe('Labels', () => {
  test('can create a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-create')
    await createBoard(page, 'Labels Board')

    await openLabelsSettings(page)

    await page.getByPlaceholder('New label...').fill('Bug')
    await page.locator('button[style*="background-color"]').nth(1).click()
    await page.getByPlaceholder('New label...').press('Enter')

    await expect(page.getByText('Bug')).toBeVisible()
  })

  test('can edit a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-edit')
    const board = await createBoard(page, 'Labels Board')

    // Create label via tRPC for speed
    await createLabel(page, board.id, 'Feature', '#3b82f6')

    // Reload so the UI picks up the label, then open settings
    await page.reload()
    await openLabelsSettings(page)
    await expect(page.getByText('Feature')).toBeVisible()

    // Hover and click edit
    const labelRow = page.locator('.group').filter({ hasText: 'Feature' })
    await labelRow.hover()
    await labelRow.locator('button').first().click()

    // After clicking edit, the label row's text content changes (name is now in an input).
    // Locate the edit container via the Save button, then find the input inside it.
    const editContainer = page.locator('.group').filter({ has: page.getByRole('button', { name: 'Save' }) })
    const editInput = editContainer.locator('input')
    await editInput.fill('Enhancement')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Enhancement')).toBeVisible()
  })

  test('can delete a board label', async ({ page }) => {
    await registerAndLogin(page, 'labels-delete')
    const board = await createBoard(page, 'Labels Board')

    // Create label via tRPC
    await createLabel(page, board.id, 'ToDelete', '#ef4444')

    await page.reload()
    await openLabelsSettings(page)
    await expect(page.getByText('ToDelete')).toBeVisible()

    const labelRow = page.locator('.group').filter({ hasText: 'ToDelete' })
    await labelRow.hover()
    await labelRow.locator('button').nth(1).click()

    await expect(page.getByText('ToDelete')).not.toBeVisible()
  })

  test('can assign a label to a task', async ({ page }) => {
    await registerAndLogin(page, 'labels-assign')
    const board = await createBoard(page, 'Labels Board')

    // Create label + column via tRPC
    await createLabel(page, board.id, 'Critical', '#ef4444')
    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()

    // Create task via UI
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('My Task')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(main(page).getByText('My Task')).toBeVisible()

    // Open task dialog and assign label
    await main(page).getByText('My Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByText('Add labels...').click()
    await page.getByRole('button').filter({ hasText: 'Critical' }).last().click()

    // Close popovers
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Verify label on task card
    await expect(main(page).getByText('Critical')).toBeVisible()
  })
})
