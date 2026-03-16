# Dashboard Home Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant "All Boards" page with a personal dashboard showing stats, upcoming tasks, and cross-board activity.

**Architecture:** The dashboard page fetches tasks and activity from each board in parallel, aggregates client-side, and renders three sections (stats strip, task list, activity feed). No backend changes — all data comes from existing endpoints.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand, Lucide icons, existing Liquid Glass design tokens.

**Spec:** `docs/superpowers/specs/2026-03-16-dashboard-home-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/lib/api.ts` | Extend `listTasks` to accept `limit` param |
| `frontend/src/lib/dashboard.ts` | **New** — Pure data-fetching and aggregation logic for the dashboard |
| `frontend/src/pages/DashboardPage.tsx` | **New** — Dashboard page component (replaces `BoardsListPage`) |
| `frontend/src/pages/BoardsListPage.tsx` | **Delete** |
| `frontend/src/App.tsx` | Update import to `DashboardPage` |

---

## Chunk 1: API and Data Layer

### Task 1: Extend `api.listTasks` to accept params

**Files:**
- Modify: `frontend/src/lib/api.ts:50-51`

- [ ] **Step 1: Update `listTasks` signature**

In `frontend/src/lib/api.ts`, change:

```typescript
// Before (line 50-51):
listTasks: (boardId: string) =>
    request<Task[]>(`/boards/${boardId}/tasks`),

// After:
listTasks: (boardId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    const query = qs.toString()
    return request<Task[]>(`/boards/${boardId}/tasks${query ? `?${query}` : ''}`)
},
```

- [ ] **Step 2: Verify existing call sites still work**

The only call site is `frontend/src/stores/board.ts` which calls `api.listTasks(id)` with no second arg. The new param is optional, so no breakage.

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): extend listTasks to accept limit/offset params"
```

### Task 2: Create dashboard data layer

**Files:**
- Create: `frontend/src/lib/dashboard.ts`

This module contains all the data-fetching and aggregation logic for the dashboard, keeping the page component focused on rendering.

- [ ] **Step 1: Create `frontend/src/lib/dashboard.ts`**

```typescript
import { api, type Board, type Task, type ActivityEntry } from '@/lib/api'

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
    const tasks = await api.listTasks(board.id, { limit: 500 })
    return tasks
      .filter((t) => t.assignee === userId && !t.archived)
      .map((t) => ({ ...t, boardName: board.name }))
  } catch {
    return [] // Partial failure: skip silently
  }
}

async function fetchBoardActivity(board: Board): Promise<DashboardActivity[]> {
  try {
    const entries = await api.listActivity(board.id, { limit: 10 })
    return entries.map((e) => ({ ...e, boardName: board.name }))
  } catch {
    return []
  }
}

async function fetchBoardArchiveCount(board: Board): Promise<number> {
  try {
    const entries = await api.listActivity(board.id, {
      action: 'task_archived',
      limit: 50,
    })
    const cutoff = Date.now() - 7 * DAY_MS
    return entries.filter((e) => new Date(e.created_at).getTime() >= cutoff).length
  } catch {
    return 0
  }
}

// ─── Sort ────────────────────────────────────────────────────

function sortByDeadline(a: DashboardTask, b: DashboardTask): number {
  // Tasks with due dates come first, sorted earliest to latest.
  // Tasks without due dates go to the end.
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
  // Fire all requests in parallel across all boards.
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
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/dashboard.ts
git commit -m "feat: add dashboard data-fetching and aggregation layer"
```

---

## Chunk 2: Dashboard Page Component

### Task 3: Create the DashboardPage component

**Files:**
- Create: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Create `frontend/src/pages/DashboardPage.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import {
  fetchDashboard,
  isOverdue,
  type DashboardData,
  type DashboardTask,
  type DashboardActivity,
} from '@/lib/dashboard'
import {
  LayoutDashboard,
  ClipboardList,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Priority colors (matches ListView / BoardSubNav) ────────

const priorityBar: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-zinc-400',
}

const priorityBadge: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

// ─── Avatar colors ───────────────────────────────────────────

const AVATAR_PALETTE = [
  'bg-red-100 text-red-600',
  'bg-orange-100 text-orange-600',
  'bg-amber-100 text-amber-600',
  'bg-green-100 text-green-600',
  'bg-cyan-100 text-cyan-600',
  'bg-blue-100 text-blue-600',
  'bg-violet-100 text-violet-600',
  'bg-pink-100 text-pink-600',
  'bg-teal-100 text-teal-600',
  'bg-fuchsia-100 text-fuchsia-600',
]

function avatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

// ─── Relative time / date helpers ────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function relativeDeadline(dueDateStr: string): { text: string; className: string } {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr)
  due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - now.getTime()) / 86_400_000)

  if (diffDays < -1) return { text: `${Math.abs(diffDays)} days ago`, className: 'font-semibold text-destructive' }
  if (diffDays === -1) return { text: 'yesterday', className: 'font-semibold text-destructive' }
  if (diffDays === 0) return { text: 'today', className: 'font-semibold text-orange-600 dark:text-orange-400' }
  if (diffDays === 1) return { text: 'tomorrow', className: 'font-semibold text-orange-600 dark:text-orange-400' }
  if (diffDays <= 3) return { text: `in ${diffDays} days`, className: 'text-orange-600 dark:text-orange-400' }
  return {
    text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    className: 'text-muted-foreground',
  }
}

// ─── Action text for activity ────────────────────────────────

function renderAction(entry: DashboardActivity): React.ReactNode {
  let details: Record<string, string> = {}
  if (entry.details) {
    try { details = JSON.parse(entry.details) } catch { /* ignore */ }
  }
  const user = <span className="font-medium">{entry.user_name}</span>
  const title = details.title ? <span className="font-medium">{details.title}</span> : null

  switch (entry.action) {
    case 'task_created': return <>{user} created {title}</>
    case 'task_updated': return <>{user} updated {title}</>
    case 'task_moved': return <>{user} moved {title}</>
    case 'task_deleted': return <>{user} deleted {title}</>
    case 'task_archived': return <>{user} archived {title}</>
    case 'task_unarchived': return <>{user} restored {title}</>
    case 'comment_added': return <>{user} commented on {title ?? 'a task'}</>
    case 'column_created': return <>{user} created column {details.name ? <span className="font-medium">{details.name}</span> : null}</>
    default: return <>{user} {entry.action.replace(/_/g, ' ')}</>
  }
}

// ─── Skeleton ────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl glass glass-border ${className}`} />
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[88px]" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[320px]" />
        <Skeleton className="h-[320px]" />
      </div>
    </>
  )
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  valueClass = '',
}: {
  label: string
  value: number
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  valueClass?: string
}) {
  return (
    <div className="glass glass-border rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="size-3.5 text-muted-foreground/50" />
      </div>
      <div className={`mt-1 text-2xl font-extrabold ${valueClass}`}>{value}</div>
      <div className="mt-0.5 text-[0.65rem] text-muted-foreground">{subtitle}</div>
    </div>
  )
}

// ─── Task Row ────────────────────────────────────────────────

function TaskRow({ task }: { task: DashboardTask }) {
  const overdue = task.due_date ? isOverdue(task.due_date) : false
  const deadline = task.due_date ? relativeDeadline(task.due_date) : null
  const priority = task.priority?.toLowerCase() ?? 'medium'

  return (
    <a
      href={`#/boards/${task.board_id}`}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
        overdue
          ? 'bg-destructive/[4%] border border-destructive/10'
          : 'border border-transparent hover:bg-foreground/[3%]'
      } ${!task.due_date ? 'opacity-70' : ''}`}
    >
      <div className={`w-[3px] self-stretch rounded-full ${priorityBar[priority] ?? 'bg-zinc-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{task.title}</div>
        <div className="text-[0.65rem] text-muted-foreground">{task.boardName}</div>
      </div>
      <div className="shrink-0 text-right">
        {deadline ? (
          <div className={`text-[0.65rem] ${deadline.className}`}>{deadline.text}</div>
        ) : (
          <div className="text-[0.65rem] text-muted-foreground/50">No date</div>
        )}
        <span className={`inline-block mt-0.5 rounded-md px-1.5 py-px text-[0.6rem] font-medium ${priorityBadge[priority] ?? ''}`}>
          {priority.charAt(0).toUpperCase() + priority.slice(1)}
        </span>
      </div>
    </a>
  )
}

// ─── Activity Row ────────────────────────────────────────────

function ActivityRow({ entry }: { entry: DashboardActivity }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold uppercase ${avatarColor(entry.user_id)}`}>
        {entry.user_name?.charAt(0) ?? '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] leading-snug">{renderAction(entry)}</p>
        <p className="mt-0.5 text-[0.6rem] text-muted-foreground/60">
          {entry.boardName} · {relativeTime(entry.created_at)}
        </p>
      </div>
    </div>
  )
}

// ─── Page Component ──────────────────────────────────────────

export function DashboardPage() {
  const boards = useBoardStore((s) => s.boards)
  const boardsLoading = useBoardStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!user || boards.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const result = await fetchDashboard(boards, user.id)
      setData(result)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [boards, user])

  useEffect(() => {
    load()
  }, [load])

  // ── Empty state: no boards ──
  if (!boardsLoading && boards.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-auto">
        <header className="flex h-14 shrink-0 items-center justify-between glass-heavy glass-border px-6">
          <h1 className="text-sm font-bold">Dashboard</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl glass glass-border">
            <LayoutDashboard className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Welcome to Kanwise</p>
          <p className="text-xs text-muted-foreground">
            Create your first board from the sidebar to get started.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between glass-heavy glass-border px-6">
        <h1 className="text-sm font-bold">Dashboard</h1>
        <span className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
      </header>

      {/* Content */}
      <div className="flex flex-col gap-4 p-6">
        {(loading || boardsLoading) ? (
          <DashboardSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm font-medium">Could not load dashboard</p>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : data ? (
          <>
            {/* Stats strip */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="My Tasks"
                value={data.stats.myTasks}
                subtitle={`across ${data.stats.boardCount} board${data.stats.boardCount !== 1 ? 's' : ''}`}
                icon={ClipboardList}
              />
              <StatCard
                label="Overdue"
                value={data.stats.overdue}
                subtitle="needs attention"
                icon={AlertTriangle}
                valueClass={data.stats.overdue > 0 ? 'text-destructive' : ''}
              />
              <StatCard
                label="Due Soon"
                value={data.stats.dueSoon}
                subtitle="within 3 days"
                icon={Clock}
                valueClass={data.stats.dueSoon > 0 ? 'text-orange-600 dark:text-orange-400' : ''}
              />
              <StatCard
                label="Done This Week"
                value={data.stats.doneThisWeek}
                subtitle="keep it up"
                icon={CheckCircle2}
                valueClass={data.stats.doneThisWeek > 0 ? 'text-green-600 dark:text-green-400' : ''}
              />
            </div>

            {/* Two-column: tasks + activity */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Up Next */}
              <div className="glass glass-border rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold">Up Next</h2>
                  <span className="text-[0.65rem] text-muted-foreground">sorted by deadline</span>
                </div>
                {data.tasks.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground/50">
                    No tasks assigned to you
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {data.tasks.map((t) => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}
              </div>

              {/* Activity Feed */}
              <div className="glass glass-border rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold">Recent Activity</h2>
                  <span className="text-[0.65rem] text-muted-foreground">all boards</span>
                </div>
                {data.activity.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground/50">
                    No recent activity
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {data.activity.map((a) => <ActivityRow key={a.id} entry={a} />)}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat: add DashboardPage with stats, tasks, and activity"
```

---

## Chunk 3: Wiring and Cleanup

### Task 4: Wire up the new page and remove the old one

**Files:**
- Modify: `frontend/src/App.tsx:6,50`
- Delete: `frontend/src/pages/BoardsListPage.tsx`

- [ ] **Step 1: Update `App.tsx` import and route**

In `frontend/src/App.tsx`, change:

```typescript
// Line 7 — change import:
// Before:
import { BoardsListPage } from '@/pages/BoardsListPage'
// After:
import { DashboardPage } from '@/pages/DashboardPage'

// Line 50 — change usage:
// Before:
      <BoardsListPage />
// After:
      <DashboardPage />
```

- [ ] **Step 2: Delete `BoardsListPage.tsx`**

```bash
rm frontend/src/pages/BoardsListPage.tsx
```

- [ ] **Step 3: Verify no broken imports**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify dev server builds**

Run: `cd frontend && npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git rm frontend/src/pages/BoardsListPage.tsx
git commit -m "feat: wire DashboardPage as home, remove BoardsListPage"
```

### Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Verify dashboard loads at `#/`**

Open `http://localhost:3000`. Expected:
- Header shows "Dashboard" and today's date
- Stats strip shows 4 cards (values may be 0 if no tasks assigned)
- "Up Next" panel shows assigned tasks sorted by deadline
- "Recent Activity" panel shows cross-board activity
- Clicking a task row navigates to the correct board

- [ ] **Step 3: Verify empty state**

If you have no boards, the welcome message should show with "Create your first board from the sidebar".

- [ ] **Step 4: Verify responsive layout**

Resize browser to mobile width (~375px). Expected:
- Stats grid collapses to 2x2
- Task and activity panels stack vertically
