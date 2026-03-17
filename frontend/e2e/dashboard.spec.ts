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
    await expect(main(page).getByText('First Board')).toBeVisible()
    await expect(main(page).getByText('Second Board')).toBeVisible()
  })

  test('clicking a board card navigates to it', async ({ page }) => {
    await registerAndLogin(page, 'dash-nav')
    await createBoard(page, 'Clickable Board')
    await page.goto('/#/')

    await main(page).getByText('Clickable Board').click()
    await expect(page).toHaveURL(/#\/boards\//)
    await expect(main(page).getByRole('heading', { name: 'Clickable Board' })).toBeVisible()
  })
})
