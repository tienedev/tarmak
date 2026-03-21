import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, main } from './helpers'

test.describe('Board management', () => {
  test('dashboard shows empty state for new user', async ({ page }) => {
    await registerAndLogin(page, 'board-empty')

    const content = main(page)
    await expect(content.getByText('Welcome to Kanwise')).toBeVisible()
    await expect(content.getByText('Create your first board from the sidebar to get started.')).toBeVisible()
  })

  test('can create a board from sidebar', async ({ page }) => {
    await registerAndLogin(page, 'board-create')

    // Click sidebar "New Board" button to open creation dialog
    await page.getByRole('button', { name: 'New Board' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Fill and submit the dialog
    await page.getByRole('dialog').getByRole('textbox').fill('My First Board')
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()

    // Should navigate to the new board and show its name
    await expect(main(page).getByRole('heading', { name: 'My First Board' })).toBeVisible()
  })

  test('created boards appear in the sidebar', async ({ page }) => {
    await registerAndLogin(page, 'board-list')
    await createBoard(page, 'Alpha Board')

    // Navigate back to dashboard
    await page.goto('/#/')
    await expect(main(page).getByText('Dashboard')).toBeVisible()

    await createBoard(page, 'Beta Board')
    await page.goto('/#/')

    // Boards should appear in sidebar navigation
    await expect(page.getByRole('link', { name: 'Alpha Board' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Beta Board' })).toBeVisible()
  })

  test('can navigate to a board and back', async ({ page }) => {
    await registerAndLogin(page, 'board-nav')
    await createBoard(page, 'Navigation Board')

    await expect(page).toHaveURL(/#\/boards\//)
    await expect(main(page).getByRole('heading', { name: 'Navigation Board' })).toBeVisible()

    // Navigate back to dashboard via sidebar link or logo
    await page.goto('/#/')

    const content = main(page)
    await expect(content.getByText('Dashboard')).toBeVisible()
    // Board should be accessible from sidebar
    await expect(page.getByRole('link', { name: 'Navigation Board' })).toBeVisible()
  })
})
