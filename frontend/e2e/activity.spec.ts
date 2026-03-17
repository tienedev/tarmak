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

    await main(page).getByText('Activity').click()

    await expect(page.getByText('Activity Log')).toBeVisible()
  })

  test('creating a task generates activity entries', async ({ page }) => {
    await registerAndLogin(page, 'activity-create')
    const board = await createBoard(page, 'Activity Board')
    await createColumn(page, board.id, 'To Do')
    await page.reload()

    await createTaskViaUI(page, 'Tracked Task')

    // Open activity panel
    await main(page).getByText('Activity').click()
    await expect(page.getByText('Activity Log')).toBeVisible()

    // Should have entries related to task creation
    await expect(page.getByText(/task/i)).toBeVisible()
  })
})
