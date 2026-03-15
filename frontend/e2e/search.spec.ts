import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

async function createColumnAndTasks(
  page: import('@playwright/test').Page,
  columnName: string,
  taskNames: string[],
) {
  // Create a column
  await page.getByText('Add column').click()
  await page.getByPlaceholder('Column name...').fill(columnName)
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText(columnName)).toBeVisible()

  // Create tasks in the column
  for (const taskName of taskNames) {
    await page.getByText('Add task').click()
    await page.getByPlaceholder('Task title...').fill(taskName)
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText(taskName)).toBeVisible()
  }
}

test.describe('Search', () => {
  test('search bar expands and collapses', async ({ page }) => {
    await registerAndLogin(page, 'search')
    await createBoard(page, 'Search Board')

    // Click the search button
    await page.getByLabel('Search').click()

    // Verify input appears
    const searchInput = page.getByPlaceholder('Search tasks, comments...')
    await expect(searchInput).toBeVisible()

    // Close with Escape
    await page.keyboard.press('Escape')
    await expect(searchInput).not.toBeVisible()
  })

  test('can search for tasks by title', async ({ page }) => {
    await registerAndLogin(page, 'search')
    await createBoard(page, 'Search Board')
    await createColumnAndTasks(page, 'To Do', ['Alpha Report', 'Beta Feature'])

    // Open search and type
    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Alpha')

    // Wait for debounce (300ms) + response
    await page.waitForTimeout(500)

    // Verify results
    await expect(page.getByText('Tasks')).toBeVisible()
    await expect(page.getByText('Alpha Report')).toBeVisible()
  })

  test('shows no results for non-matching query', async ({ page }) => {
    await registerAndLogin(page, 'search')
    await createBoard(page, 'Search Board')
    await createColumnAndTasks(page, 'To Do', ['Some Task'])

    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('xyznonexistent')

    // Wait for debounce + response
    await page.waitForTimeout(500)

    // No results dropdown should appear
    await expect(page.getByText('Tasks')).not.toBeVisible()
  })

  test('clicking a search result opens the task', async ({ page }) => {
    await registerAndLogin(page, 'search')
    await createBoard(page, 'Search Board')
    await createColumnAndTasks(page, 'To Do', ['Clickable Task'])

    // Search for the task
    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Clickable')
    await page.waitForTimeout(500)

    // Click the result
    await page.getByText('Clickable Task').last().click()

    // Verify the task dialog opens
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Clickable Task')).toBeVisible()
  })
})
