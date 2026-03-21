import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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

function relativeTime(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return t('dashboard.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('dashboard.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('dashboard.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days === 1) return t('dashboard.yesterday')
  if (days < 7) return t('dashboard.daysAgo', { count: days })
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
  const { t } = useTranslation()
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
          <div className="text-[0.65rem] text-muted-foreground/50">{t('dashboard.noDate')}</div>
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
  const { t } = useTranslation()
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold uppercase ${avatarColor(entry.user_id)}`}>
        {entry.user_name?.charAt(0) ?? '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] leading-snug">{renderAction(entry)}</p>
        <p className="mt-0.5 text-[0.6rem] text-muted-foreground/60">
          {entry.boardName} · {relativeTime(entry.created_at, t)}
        </p>
      </div>
    </div>
  )
}

// ─── Page Component ──────────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation()
  const boards = useBoardStore((s) => s.boards)
  const boardsLoading = useBoardStore((s) => s.loading)
  const fetchBoards = useBoardStore((s) => s.fetchBoards)
  const user = useAuthStore((s) => s.user)

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Refresh board list every time the dashboard mounts
  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

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
          <h1 className="text-sm font-bold">{t('dashboard.title')}</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl glass glass-border">
            <LayoutDashboard className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{t('dashboard.welcome')}</p>
          <p className="text-xs text-muted-foreground">
            {t('dashboard.getStarted')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between glass-heavy glass-border px-6">
        <h1 className="text-sm font-bold">{t('dashboard.title')}</h1>
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
            <p className="text-sm font-medium">{t('dashboard.loadFailed')}</p>
            <Button size="sm" variant="outline" onClick={load}>{t('common.retry')}</Button>
          </div>
        ) : data ? (
          <>
            {/* Stats strip */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t('dashboard.myTasks')}
                value={data.stats.myTasks}
                subtitle={t('dashboard.acrossBoards', { count: data.stats.boardCount })}
                icon={ClipboardList}
              />
              <StatCard
                label={t('dashboard.overdue')}
                value={data.stats.overdue}
                subtitle={t('dashboard.needsAttention')}
                icon={AlertTriangle}
                valueClass={data.stats.overdue > 0 ? 'text-destructive' : ''}
              />
              <StatCard
                label={t('dashboard.dueSoon')}
                value={data.stats.dueSoon}
                subtitle={t('dashboard.within3Days')}
                icon={Clock}
                valueClass={data.stats.dueSoon > 0 ? 'text-orange-600 dark:text-orange-400' : ''}
              />
              <StatCard
                label={t('dashboard.doneThisWeek')}
                value={data.stats.doneThisWeek}
                subtitle={t('dashboard.keepItUp')}
                icon={CheckCircle2}
                valueClass={data.stats.doneThisWeek > 0 ? 'text-green-600 dark:text-green-400' : ''}
              />
            </div>

            {/* Two-column: tasks + activity */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Up Next */}
              <div className="glass glass-border rounded-2xl p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold">{t('dashboard.upNext')}</h2>
                  <span className="text-[0.65rem] text-muted-foreground">{t('dashboard.sortedByDeadline')}</span>
                </div>
                {data.tasks.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground/50">
                    {t('dashboard.noTasks')}
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
                  <h2 className="text-xs font-bold">{t('dashboard.recentActivity')}</h2>
                  <span className="text-[0.65rem] text-muted-foreground">{t('dashboard.allBoards')}</span>
                </div>
                {data.activity.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground/50">
                    {t('dashboard.noActivity')}
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
