import { test, expect } from '@playwright/test'

const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e-${Date.now()}@test.com`,
  password: 'testpassword123',
}

test.describe('Login flow', () => {
  test('login page loads and displays the form', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('user can register, then login', async ({ page }) => {
    await page.goto('/')

    // Switch to register form
    await page.getByText('Create one').click()
    await expect(page.getByText('Create an account')).toBeVisible()

    // Fill in registration form
    await page.getByLabel('Name').fill(TEST_USER.name)
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Should redirect to boards list (hash router: #/ or empty)
    await expect(page).toHaveURL(/\/#?\/?$/)

    // Logout by clearing localStorage and reloading
    await page.evaluate(() => localStorage.removeItem('token'))
    await page.reload()

    // Should be back on login
    await expect(page.getByText('Welcome back')).toBeVisible()

    // Login with the registered account
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill(TEST_USER.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should redirect to boards list again
    await expect(page).toHaveURL(/\/#?\/?$/)
  })
})
