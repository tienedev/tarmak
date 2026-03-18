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

    await main(page).getByRole('button', { name: 'Activity' }).click()

    // The activity panel has a "No activity yet" empty state or filter dropdowns
    await expect(page.getByText('No activity yet')).toBeVisible()
  })

  test('creating a task generates activity entries', async ({ page }) => {
    await registerAndLogin(page, 'activity-create')
    const board = await createBoard(page, 'Activity Board')
    await createColumn(page, board.id, 'To Do')
    await page.reload()

    await createTaskViaUI(page, 'Tracked Task')

    // Open activity panel
    await main(page).getByRole('button', { name: 'Activity' }).click()

    // Should have entries related to task creation
    await expect(page.getByText(/created/).first()).toBeVisible()
  })
})
