import { test, expect } from '@playwright/test'
import {
  registerAndLogin,
  createBoard,
  createColumn,
  createTask,
  createComment,
  main,
} from './helpers'

test.describe('Comments', () => {
  let boardId: string
  let columnId: string

  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'comment')
    const board = await createBoard(page, 'Comment Board')
    boardId = board.id
    const col = await createColumn(page, boardId, 'To Do')
    columnId = col.id
    await page.reload()
    await expect(main(page).getByText('To Do')).toBeVisible()
  })

  test('comments section is collapsed by default', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Cmt Task')
    await page.reload()
    await main(page).getByText('Cmt Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // "Comments" button should be visible (collapsed header)
    await expect(page.getByRole('dialog').getByRole('button', { name: /Comments/ })).toBeVisible()
    // Comment input should not be visible when collapsed
    await expect(page.getByRole('dialog').getByText('No comments yet')).not.toBeVisible()
  })

  test('can expand comments section and see empty state', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Empty Cmt Task')
    await page.reload()
    await main(page).getByText('Empty Cmt Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Click the Comments collapsible button
    await page.getByRole('dialog').getByRole('button', { name: /Comments/ }).click()
    await expect(page.getByRole('dialog').getByText('No comments yet')).toBeVisible()
  })

  test('can add a comment', async ({ page }) => {
    await createTask(page, boardId, columnId, 'Add Cmt Task')
    await page.reload()
    await main(page).getByText('Add Cmt Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Expand comments
    await page.getByRole('dialog').getByRole('button', { name: /Comments/ }).click()
    await expect(page.getByRole('dialog').getByText('No comments yet')).toBeVisible()

    // Type in the Tiptap editor (contenteditable div)
    const editor = page.getByRole('dialog').locator('.tiptap').last()
    await editor.click()
    await editor.fill('Hello from E2E test')

    // Click Comment button
    await page.getByRole('dialog').getByRole('button', { name: 'Comment', exact: true }).click()

    // Comment should appear
    await expect(page.getByRole('dialog').getByText('Hello from E2E test')).toBeVisible()
    // "No comments yet" should be gone
    await expect(page.getByRole('dialog').getByText('No comments yet')).not.toBeVisible()
  })

  test('shows existing comments from API', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Existing Cmt')
    await createComment(page, task.id, '<p>API comment</p>')

    await page.reload()
    await main(page).getByText('Existing Cmt').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Expand comments
    await page.getByRole('dialog').getByRole('button', { name: /Comments/ }).click()

    await expect(page.getByRole('dialog').getByText('API comment')).toBeVisible()
  })

  test('comment count badge shows after adding comments', async ({ page }) => {
    const task = await createTask(page, boardId, columnId, 'Badge Task')
    await createComment(page, task.id, '<p>Comment 1</p>')
    await createComment(page, task.id, '<p>Comment 2</p>')

    await page.reload()
    await main(page).getByText('Badge Task').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // The comments header should show a badge with "2"
    const commentsBtn = page.getByRole('dialog').getByRole('button', { name: /Comments/ })
    await expect(commentsBtn.getByText('2')).toBeVisible()
  })
})
