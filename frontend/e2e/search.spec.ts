import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn } from './helpers'

async function createTaskViaUI(page: import('@playwright/test').Page, title: string) {
  await page.getByText('Add task').click()
  await page.getByPlaceholder('Task title...').fill(title)
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText(title)).toBeVisible()
}

test.describe('Search', () => {
  test('search bar expands and collapses', async ({ page }) => {
    await registerAndLogin(page, 'search-toggle')
    await createBoard(page, 'Search Board')

    await page.getByLabel('Search').click()

    const searchInput = page.getByPlaceholder('Search tasks, comments...')
    await expect(searchInput).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(searchInput).not.toBeVisible()
  })

  test('can search for tasks by title', async ({ page }) => {
    await registerAndLogin(page, 'search-query')
    const board = await createBoard(page, 'Search Board')

    // Setup: column + tasks via API/UI
    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(page.getByText('To Do')).toBeVisible()

    await createTaskViaUI(page, 'Alpha Report')
    await createTaskViaUI(page, 'Beta Feature')

    // Search
    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Alpha')
    await page.waitForTimeout(500)

    await expect(page.getByText('Tasks')).toBeVisible()
    await expect(page.getByText('Alpha Report')).toBeVisible()
  })

  test('shows no results for non-matching query', async ({ page }) => {
    await registerAndLogin(page, 'search-empty')
    const board = await createBoard(page, 'Search Board')

    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(page.getByText('To Do')).toBeVisible()
    await createTaskViaUI(page, 'Some Task')

    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('xyznonexistent')
    await page.waitForTimeout(500)

    // No results section should not appear
    await expect(page.getByText('Tasks').last()).not.toBeVisible()
  })

  test('clicking a search result opens the task', async ({ page }) => {
    await registerAndLogin(page, 'search-click')
    const board = await createBoard(page, 'Search Board')

    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(page.getByText('To Do')).toBeVisible()
    await createTaskViaUI(page, 'Clickable Task')

    await page.getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Clickable')
    await page.waitForTimeout(500)

    await page.getByText('Clickable Task').last().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Clickable Task')).toBeVisible()
  })
})
