import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

test.describe('Board management', () => {
  test('boards list shows empty state for new user', async ({ page }) => {
    await registerAndLogin(page, 'board')

    await expect(page.getByText('No boards yet')).toBeVisible()
    await expect(
      page.getByText('Create your first board to get started.'),
    ).toBeVisible()
  })

  test('can create a board from empty state', async ({ page }) => {
    await registerAndLogin(page, 'board')

    // Click the "Create Board" button in the empty state
    await page.getByRole('button', { name: 'Create Board' }).click()
    await expect(page.getByText('Create Board').first()).toBeVisible()

    await page.getByPlaceholder('e.g. Product Roadmap').fill('My First Board')
    await page.getByRole('button', { name: 'Create Board' }).last().click()

    // Should redirect to the board page
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('My First Board')).toBeVisible()
  })

  test('can create a board from header button', async ({ page }) => {
    await registerAndLogin(page, 'board')

    await page.getByRole('button', { name: 'New Board' }).click()
    await expect(page.getByText('Create Board').first()).toBeVisible()

    await page.getByPlaceholder('e.g. Product Roadmap').fill('Roadmap Board')
    await page
      .getByPlaceholder('What is this board for?')
      .fill('Track product features')
    await page.getByRole('button', { name: 'Create Board' }).last().click()

    // Should redirect to the board page
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('Roadmap Board')).toBeVisible()
  })

  test('created boards appear in the list', async ({ page }) => {
    await registerAndLogin(page, 'board')

    // Create first board using the helper (which uses the "New Board" header button)
    await createBoard(page, 'Alpha Board')
    await expect(page.getByText('Alpha Board')).toBeVisible()

    // Go back to boards list
    await page.getByLabel('Back to boards').click()
    await expect(page.getByText('All Boards')).toBeVisible()

    // Create second board
    await createBoard(page, 'Beta Board')
    await expect(page.getByText('Beta Board')).toBeVisible()

    // Go back to boards list and verify both boards are present
    await page.getByLabel('Back to boards').click()
    await expect(page.getByText('All Boards')).toBeVisible()

    await expect(page.getByText('Alpha Board')).toBeVisible()
    await expect(page.getByText('Beta Board')).toBeVisible()
  })

  test('can navigate to a board and back', async ({ page }) => {
    await registerAndLogin(page, 'board')
    await createBoard(page, 'Navigation Board')

    // Verify we are on the board page
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(page.getByText('Navigation Board')).toBeVisible()

    // Click back button to return to boards list
    await page.getByLabel('Back to boards').click()

    // Verify we are back on the boards list
    await expect(page.getByText('All Boards')).toBeVisible()
    await expect(page.getByText('Navigation Board')).toBeVisible()
  })
})
