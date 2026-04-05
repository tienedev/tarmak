import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task, Column } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

const priorityBarColors: Record<string, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-500',
  medium: 'bg-amber-400',
  low:    'bg-zinc-400',
  none:   'bg-zinc-300',
}

const priorityBarHoverColors: Record<string, string> = {
  urgent: 'hover:bg-red-600',
  high:   'hover:bg-orange-600',
  medium: 'hover:bg-amber-500',
  low:    'hover:bg-zinc-500',
  none:   'hover:bg-zinc-400',
}

interface TimelineViewProps {
  columns: Column[]
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}

interface TimelineRange {
  start: Date
  end: Date
  days: number
}

function computeRange(tasks: Task[]): TimelineRange {
  if (tasks.length === 0) {
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - 3)
    const end = new Date(now)
    end.setDate(end.getDate() + 3)
    return { start, end, days: 7 }
  }

  const timestamps = tasks.map((t) => new Date(t.created_at).getTime())
  const minTs = Math.min(...timestamps)
  const maxTs = Math.max(...timestamps)

  // Add padding of 1 day on each side
  const start = new Date(minTs)
  start.setDate(start.getDate() - 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(maxTs)
  end.setDate(end.getDate() + 2)
  end.setHours(0, 0, 0, 0)

  const days = Math.max(Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)), 3)
  return { start, end, days }
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function TimelineView({ columns, tasks, onTaskClick }: TimelineViewProps) {
  const { t } = useTranslation()
  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  )

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const col of columns) {
      map.set(col.id, [])
    }
    for (const task of tasks) {
      const arr = map.get(task.column_id)
      if (arr) arr.push(task)
    }
    return map
  }, [columns, tasks])

  const range = useMemo(() => computeRange(tasks), [tasks])

  const dayLabels = useMemo(() => {
    const labels: { date: Date; label: string }[] = []
    const d = new Date(range.start)
    for (let i = 0; i < range.days; i++) {
      labels.push({ date: new Date(d), label: formatDay(d) })
      d.setDate(d.getDate() + 1)
    }
    return labels
  }, [range])

  function getBarPosition(task: Task): { left: string; width: string } {
    const created = new Date(task.created_at).getTime()
    const updated = new Date(task.updated_at).getTime()
    const rangeMs = range.end.getTime() - range.start.getTime()

    const startPct = Math.max(0, ((created - range.start.getTime()) / rangeMs) * 100)
    // Bar spans from created to updated, minimum 3% width for visibility
    const durationPct = Math.max(3, ((updated - created) / rangeMs) * 100)

    return {
      left: `${startPct}%`,
      width: `${Math.min(durationPct, 100 - startPct)}%`,
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground/60">{t('task.noTasksTimeline')}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="min-w-[800px] px-6 py-4">
        {/* Timeline header with day markers */}
        <div className="mb-4 flex">
          {/* Column name gutter */}
          <div className="w-48 shrink-0" />

          {/* Day labels */}
          <div className="relative flex-1">
            <div className="flex">
              {dayLabels.map((d, i) => (
                <div
                  key={i}
                  className="flex-1 border-l border-border/40 px-1.5 pb-2"
                >
                  <span className="text-[0.65rem] font-medium text-muted-foreground">
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Columns and their tasks */}
        {sortedColumns.map((column) => {
          const colTasks = tasksByColumn.get(column.id) ?? []
          if (colTasks.length === 0) return null

          return (
            <div key={column.id} className="mb-5">
              {/* Column group header */}
              <div className="mb-2 flex items-center gap-2">
                {column.color && (
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: column.color }}
                  />
                )}
                <span className="text-xs font-semibold text-foreground">
                  {column.name}
                </span>
                <span className="text-[0.65rem] text-muted-foreground">
                  {colTasks.length}
                </span>
              </div>

              {/* Task rows */}
              {colTasks
                .sort((a, b) => a.position - b.position)
                .map((task) => {
                  const pos = getBarPosition(task)
                  const barColor = priorityBarColors[task.priority] ?? priorityBarColors.none
                  const hoverColor = priorityBarHoverColors[task.priority] ?? priorityBarHoverColors.none

                  return (
                    <div key={task.id} className="flex items-center py-1">
                      {/* Task name gutter */}
                      <div className="w-48 shrink-0 pr-3">
                        <span className="truncate text-xs text-muted-foreground">
                          {task.title}
                        </span>
                      </div>

                      {/* Timeline bar area */}
                      <div className="relative h-6 flex-1 rounded bg-muted/30">
                        {/* Day grid lines */}
                        {dayLabels.map((_, i) => (
                          <div
                            key={i}
                            className="absolute top-0 bottom-0 border-l border-border/20"
                            style={{ left: `${(i / range.days) * 100}%` }}
                          />
                        ))}

                        {/* Task bar */}
                        <div
                          className={cn(
                            'absolute top-0.5 bottom-0.5 rounded transition-colors cursor-pointer',
                            barColor,
                            hoverColor,
                          )}
                          style={{ left: pos.left, width: pos.width }}
                          title={`${task.title} (${task.priority})`}
                          onClick={() => onTaskClick?.(task)}
                        />
                      </div>
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
