import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, main, sidebarBoard } from './helpers'

test.describe('Dashboard', () => {
  test('shows welcome message for new user', async ({ page }) => {
    await registerAndLogin(page, 'dash-welcome')
    await expect(main(page).getByText('Welcome to Tarmak')).toBeVisible()
  })

  test('lists boards as cards when boards exist', async ({ page }) => {
    await registerAndLogin(page, 'dash-list')
    await createBoard(page, 'First Board')
    await page.goto('/#/')
    await createBoard(page, 'Second Board')
    await page.goto('/#/')

    await expect(main(page).getByText('Dashboard')).toBeVisible()
    // Boards should be listed in sidebar
    await expect(sidebarBoard(page, 'First Board')).toBeVisible()
    await expect(sidebarBoard(page, 'Second Board')).toBeVisible()
  })

  test('clicking a board in sidebar navigates to it', async ({ page }) => {
    await registerAndLogin(page, 'dash-nav')
    await createBoard(page, 'Clickable Board')
    await page.goto('/#/')

    // Wait for the sidebar to load the board list
    await expect(sidebarBoard(page, 'Clickable Board')).toBeVisible({ timeout: 10_000 })

    // Expand the board in sidebar to reveal the "Board" sub-link
    await sidebarBoard(page, 'Clickable Board').click()
    const boardLink = page.locator('aside a', { hasText: 'Board' }).first()
    await expect(boardLink).toBeVisible({ timeout: 5_000 })
    await boardLink.click()
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(main(page).getByRole('heading', { name: 'Clickable Board' })).toBeVisible()
  })
})
