import { trpcClient } from '@/lib/trpc'
import type { Board, Task, ActivityEntry } from '@/lib/types'

// ─── Types ───────────────────────────────────────────────────

export interface DashboardStats {
  myTasks: number
  boardCount: number
  overdue: number
  dueSoon: number
  doneThisWeek: number
}

export interface DashboardTask extends Task {
  boardName: string
}

export interface DashboardActivity extends ActivityEntry {
  boardName: string
}

export interface DashboardData {
  stats: DashboardStats
  tasks: DashboardTask[]
  activity: DashboardActivity[]
}

// ─── Helpers ─────────────────────────────────────────────────

const DAY_MS = 86_400_000

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isOverdue(dueDateStr: string): boolean {
  return new Date(dueDateStr).getTime() < startOfToday()
}

function isDueSoon(dueDateStr: string): boolean {
  const due = new Date(dueDateStr).getTime()
  const today = startOfToday()
  return due >= today && due <= today + 3 * DAY_MS
}

// ─── Fetch ───────────────────────────────────────────────────

async function fetchBoardTasks(
  board: Board,
  userId: string,
): Promise<DashboardTask[]> {
  try {
    const tasks = await trpcClient.task.list.query({ boardId: board.id, limit: 500 }) as Task[]
    return tasks
      .filter((t) => t.assignee === userId && !t.archived)
      .map((t) => ({ ...t, boardName: board.name }))
  } catch {
    return [] // Partial failure: skip silently
  }
}

async function fetchBoardActivity(board: Board): Promise<DashboardActivity[]> {
  try {
    const entries = await trpcClient.activity.list.query({ boardId: board.id, limit: 10 }) as ActivityEntry[]
    return entries.map((e) => ({ ...e, boardName: board.name }))
  } catch {
    return []
  }
}

async function fetchBoardArchiveCount(board: Board): Promise<number> {
  try {
    const entries = await trpcClient.activity.list.query({
      boardId: board.id,
      limit: 50,
    }) as ActivityEntry[]
    const cutoff = Date.now() - 7 * DAY_MS
    return entries
      .filter((e) => e.action === 'task_archived')
      .filter((e) => new Date(e.created_at).getTime() >= cutoff).length
  } catch {
    return 0
  }
}

// ─── Sort ────────────────────────────────────────────────────

function sortByDeadline(a: DashboardTask, b: DashboardTask): number {
  if (a.due_date && b.due_date) {
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  }
  if (a.due_date) return -1
  if (b.due_date) return 1
  return 0
}

// ─── Public API ──────────────────────────────────────────────

export async function fetchDashboard(
  boards: Board[],
  userId: string,
): Promise<DashboardData> {
  const [taskArrays, activityArrays, archiveCounts] = await Promise.all([
    Promise.all(boards.map((b) => fetchBoardTasks(b, userId))),
    Promise.all(boards.map((b) => fetchBoardActivity(b))),
    Promise.all(boards.map((b) => fetchBoardArchiveCount(b))),
  ])

  const allTasks = taskArrays.flat().sort(sortByDeadline)

  const allActivity = activityArrays
    .flat()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20)

  const doneThisWeek = archiveCounts.reduce((sum, n) => sum + n, 0)

  const stats: DashboardStats = {
    myTasks: allTasks.length,
    boardCount: boards.length,
    overdue: allTasks.filter((t) => t.due_date && isOverdue(t.due_date)).length,
    dueSoon: allTasks.filter((t) => t.due_date && isDueSoon(t.due_date)).length,
    doneThisWeek,
  }

  return { stats, tasks: allTasks, activity: allActivity }
}
