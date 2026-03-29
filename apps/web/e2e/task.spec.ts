import { test, expect } from '@playwright/test'
import { registerAndLogin, createBoard, createColumn, main } from './helpers'

let boardId: string

test.describe('Task lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'task')
    const board = await createBoard(page, 'Task Board')
    boardId = board.id

    await createColumn(page, boardId, 'To Do')
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
  })

  test('can create a task in a column', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('My first task')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(main(page).getByText('My first task')).toBeVisible()
  })

  test('can create a task with priority', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('High priority task')

    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'High' }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await expect(main(page).getByText('High priority task')).toBeVisible()
  })

  test('can open task detail dialog', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('Dialog task')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await main(page).getByText('Dialog task').click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Dialog task' })).toBeVisible()
  })

  test('can edit task title', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('Original title')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await main(page).getByText('Original title').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Original title' }).click()
    const titleInput = page.getByRole('dialog').locator('input').first()
    await titleInput.fill('Updated title')
    await titleInput.press('Enter')

    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Updated title' })).toBeVisible()
  })

  test('can edit task priority', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('Priority edit task')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await main(page).getByText('Priority edit task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('dialog').getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Urgent' }).click()

    await expect(page.getByRole('dialog').getByText('Urgent')).toBeVisible()
  })

  test('can delete a task', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add task' }).click()
    await page.getByPlaceholder('Task title...').fill('Task to delete')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    await main(page).getByText('Task to delete').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    page.on('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(main(page).getByText('Task to delete')).toBeHidden()
  })
})
