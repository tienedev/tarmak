import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTaskViaUI,
  main,
} from './helpers'

test.describe('Activity panel', () => {
  test('activity button opens the activity panel', async ({ page }) => {
    await registerAndLogin(page, 'activity-open')
    await createBoard(page, 'Activity Board')

    // Click the Activity button in the header (scoped to main to avoid ambiguity)
    await main(page).getByRole('button', { name: 'Activity' }).click()

    // The drawer title is "Activity" rendered via SheetTitle
    await expect(page.locator('[role="dialog"]').getByText('Activity')).toBeVisible()
  })

  test('creating a task generates activity entries', async ({ page }) => {
    await registerAndLogin(page, 'activity-create')
    const board = await createBoard(page, 'Activity Board')
    await createColumn(page, board.id, 'To Do')
    await page.reload()

    await createTaskViaUI(page, 'Tracked Task')

    // Open activity panel via header button
    await main(page).getByRole('button', { name: 'Activity' }).click()
    await expect(page.locator('[role="dialog"]').getByText('Activity')).toBeVisible()

    // Should have entries related to task creation
    await expect(page.locator('[role="dialog"]').getByText(/created/i)).toBeVisible()
  })
})
