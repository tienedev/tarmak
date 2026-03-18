import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, main } from './helpers'

test.describe('Dashboard', () => {
  test('shows welcome message for new user', async ({ page }) => {
    await registerAndLogin(page, 'dash-welcome')
    await expect(main(page).getByText('Welcome to Kanwise')).toBeVisible()
  })

  test('lists boards as cards when boards exist', async ({ page }) => {
    await registerAndLogin(page, 'dash-list')
    await createBoard(page, 'First Board')
    await page.goto('/#/')
    await createBoard(page, 'Second Board')
    await page.goto('/#/')

    await expect(main(page).getByText('Dashboard')).toBeVisible()
    // Boards should be listed in sidebar
    await expect(page.getByRole('link', { name: 'First Board' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Second Board' })).toBeVisible()
  })

  test('clicking a board in sidebar navigates to it', async ({ page }) => {
    await registerAndLogin(page, 'dash-nav')
    await createBoard(page, 'Clickable Board')
    await page.goto('/#/')

    await page.getByRole('link', { name: 'Clickable Board' }).click()
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(main(page).getByRole('heading', { name: 'Clickable Board' })).toBeVisible()
  })
})
