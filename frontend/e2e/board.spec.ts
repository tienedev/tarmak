import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

test.describe('Board management', () => {
  test('boards list shows empty state for new user', async ({ page }) => {
    await registerAndLogin(page, 'board-empty')

    await expect(page.getByText('No boards yet')).toBeVisible()
    await expect(page.getByText('Create your first board to get started.')).toBeVisible()
  })

  test('can create a board from empty state', async ({ page }) => {
    await registerAndLogin(page, 'board-create')

    // Click the empty-state "Create Board" button (opens dialog)
    await page.getByRole('button', { name: 'Create Board' }).click()

    await page.getByPlaceholder('e.g. Product Roadmap').fill('My First Board')
    await page.getByRole('button', { name: 'Create Board' }).click()

    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('My First Board')).toBeVisible()
  })

  test('can create a board from header button', async ({ page }) => {
    // Create one board via API first so the empty state doesn't show
    await registerAndLogin(page, 'board-header')
    await page.request.post('/api/v1/boards', {
      data: { name: 'Placeholder' },
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}`,
      },
    })
    await page.reload()

    // Now use the header "New Board" button (scoped to header to avoid sidebar duplicate)
    await page.locator('header').getByRole('button', { name: 'New Board' }).click()

    await page.getByPlaceholder('e.g. Product Roadmap').fill('Roadmap Board')
    await page.getByPlaceholder('What is this board for?').fill('Track product features')
    await page.getByRole('button', { name: 'Create Board' }).click()

    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('Roadmap Board')).toBeVisible()
  })

  test('created boards appear in the list', async ({ page }) => {
    await registerAndLogin(page, 'board-list')
    await createBoard(page, 'Alpha Board')

    // Go back to boards list
    await page.getByLabel('Back to boards').click()
    await expect(page.getByText('All Boards')).toBeVisible()

    // Create second board and go back
    await createBoard(page, 'Beta Board')
    await page.getByLabel('Back to boards').click()

    await expect(page.getByText('Alpha Board')).toBeVisible()
    await expect(page.getByText('Beta Board')).toBeVisible()
  })

  test('can navigate to a board and back', async ({ page }) => {
    await registerAndLogin(page, 'board-nav')
    await createBoard(page, 'Navigation Board')

    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('Navigation Board')).toBeVisible()

    await page.getByLabel('Back to boards').click()

    await expect(page.getByText('All Boards')).toBeVisible()
    await expect(page.getByText('Navigation Board')).toBeVisible()
  })
})
