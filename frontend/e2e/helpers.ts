import { type Page, expect } from '@playwright/test'

/** Register a fresh user and land on the boards list page. */
export async function registerAndLogin(page: Page, prefix: string) {
  const user = {
    name: `E2E ${prefix}`,
    email: `e2e-${prefix}-${Date.now()}@test.com`,
    password: 'testpassword123',
  }

  await page.goto('/')
  await page.getByText('Create one').click()
  await expect(page.getByText('Create an account')).toBeVisible()

  await page.getByLabel('Name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Wait for boards list — confirms registration + navigation
  await expect(page.getByText('All Boards')).toBeVisible()

  return user
}

/** Create a board and navigate into it. Returns the board name. */
export async function createBoard(page: Page, name: string, description?: string) {
  await page.getByRole('button', { name: 'New Board' }).click()
  await expect(page.getByText('Create Board').first()).toBeVisible()

  await page.getByLabel('Name').fill(name)
  if (description) {
    await page.getByLabel('Description (optional)').fill(description)
  }
  await page.getByRole('button', { name: 'Create Board' }).last().click()

  // Wait for navigation to the board page
  await expect(page).toHaveURL(/#\/boards\//)
}
