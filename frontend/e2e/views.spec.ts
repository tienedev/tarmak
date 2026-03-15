import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard } from './helpers'

test.describe('View switching', () => {
  test('default view is kanban (Board tab)', async ({ page }) => {
    await registerAndLogin(page, 'views')
    await createBoard(page, 'Views Board')

    const boardTab = page.getByRole('tab', { name: 'Board' })
    await expect(boardTab).toHaveAttribute('aria-selected', 'true')
  })

  test('can switch to list view', async ({ page }) => {
    await registerAndLogin(page, 'views')
    await createBoard(page, 'Views Board')

    await page.getByRole('tab', { name: 'List' }).click()

    await expect(page).toHaveURL(/view=list/)
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Assignee' })).toBeVisible()
  })

  test('can switch to timeline view', async ({ page }) => {
    await registerAndLogin(page, 'views')
    await createBoard(page, 'Views Board')

    await page.getByRole('tab', { name: 'Timeline' }).click()

    await expect(page).toHaveURL(/view=timeline/)
  })

  test('can switch back to kanban view', async ({ page }) => {
    await registerAndLogin(page, 'views')
    await createBoard(page, 'Views Board')

    await page.getByRole('tab', { name: 'List' }).click()
    await expect(page).toHaveURL(/view=list/)

    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(page).toHaveURL(/view=kanban/)
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
  })

  test('view persists after page reload', async ({ page }) => {
    await registerAndLogin(page, 'views')
    await createBoard(page, 'Views Board')

    await page.getByRole('tab', { name: 'List' }).click()
    await expect(page).toHaveURL(/view=list/)

    await page.reload()

    await expect(page).toHaveURL(/view=list/)
    await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Assignee' })).toBeVisible()
  })
})
