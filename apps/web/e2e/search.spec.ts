import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn, main } from './helpers'

async function createTaskViaUI(page: import('@playwright/test').Page, title: string) {
  await main(page).getByRole('button', { name: 'Add task' }).click()
  await page.getByPlaceholder('Task title...').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(main(page).getByText(title)).toBeVisible()
}

test.describe('Search', () => {
  test('search bar expands and collapses', async ({ page }) => {
    await registerAndLogin(page, 'search-toggle')
    await createBoard(page, 'Search Board')

    await main(page).getByLabel('Search').click()
    const searchInput = page.getByPlaceholder('Search tasks, comments...')
    await expect(searchInput).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(searchInput).not.toBeVisible()
  })

  test('can search for tasks by title', async ({ page }) => {
    await registerAndLogin(page, 'search-query')
    const board = await createBoard(page, 'Search Board')

    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()

    await createTaskViaUI(page, 'Alpha Report')
    await createTaskViaUI(page, 'Beta Feature')

    await main(page).getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Alpha')
    await page.waitForTimeout(500)

    await expect(page.locator('.absolute').getByText('Tasks')).toBeVisible()
    await expect(page.getByText('Alpha Report').last()).toBeVisible()
  })

  test('shows no results for non-matching query', async ({ page }) => {
    await registerAndLogin(page, 'search-empty')
    const board = await createBoard(page, 'Search Board')

    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
    await createTaskViaUI(page, 'Some Task')

    await main(page).getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('xyznonexistent')
    await page.waitForTimeout(500)

    // Search results dropdown should not show "Tasks" header
    const dropdown = page.locator('.absolute')
    await expect(dropdown.getByText('Tasks')).not.toBeVisible()
  })

  test('clicking a search result opens the task', async ({ page }) => {
    await registerAndLogin(page, 'search-click')
    const board = await createBoard(page, 'Search Board')

    await createColumn(page, board.id, 'To Do')
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
    await createTaskViaUI(page, 'Clickable Task')

    await main(page).getByLabel('Search').click()
    await page.getByPlaceholder('Search tasks, comments...').fill('Clickable')
    await page.waitForTimeout(500)

    await page.getByText('Clickable Task').last().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Clickable Task' })).toBeVisible()
  })
})
