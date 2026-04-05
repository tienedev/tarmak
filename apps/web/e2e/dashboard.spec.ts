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
    const board = await createBoard(page, 'Clickable Board')
    await page.goto('/#/')

    // Wait for the sidebar to load the board list
    const boardBtn = sidebarBoard(page, 'Clickable Board')
    await expect(boardBtn).toBeVisible({ timeout: 10_000 })

    // Expand the board in sidebar to reveal sub-links
    await boardBtn.click()

    // Target the board sub-link by its href (avoids matching the board name button)
    const boardLink = page.locator(`aside a[href="#/boards/${board.id}"]`).first()
    await expect(boardLink).toBeVisible({ timeout: 5_000 })
    await boardLink.click()
    await expect(page).toHaveURL(new RegExp(`#/boards/${board.id}`))
    await expect(main(page).getByRole('heading', { name: 'Clickable Board' })).toBeVisible()
  })
})
