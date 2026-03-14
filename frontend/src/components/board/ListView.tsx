import { useState, useMemo } from 'react'
import type { Task, Column } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'

const priorityConfig: Record<string, { label: string; color: string; bg: string; order: number }> = {
  urgent: { label: 'Urgent', color: 'bg-red-500', bg: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400', order: 0 },
  high:   { label: 'High',   color: 'bg-orange-500', bg: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', order: 1 },
  medium: { label: 'Medium', color: 'bg-yellow-500', bg: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', order: 2 },
  low:    { label: 'Low',    color: 'bg-zinc-400', bg: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400', order: 3 },
  none:   { label: 'None',   color: 'bg-zinc-300', bg: 'bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-500', order: 4 },
}

type SortKey = 'title' | 'status' | 'priority' | 'assignee'
type SortDir = 'asc' | 'desc'

interface ListViewProps {
  columns: Column[]
  tasks: Task[]
  onTaskClick?: (task: Task) => void
}

export function ListView({ columns, tasks, onTaskClick }: ListViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const columnMap = useMemo(() => {
    const map = new Map<string, Column>()
    for (const col of columns) {
      map.set(col.id, col)
    }
    return map
  }, [columns])

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'title':
          cmp = a.title.localeCompare(b.title)
          break
        case 'status': {
          const colA = columnMap.get(a.column_id)
          const colB = columnMap.get(b.column_id)
          cmp = (colA?.position ?? 0) - (colB?.position ?? 0)
          break
        }
        case 'priority': {
          const orderA = priorityConfig[a.priority]?.order ?? 4
          const orderB = priorityConfig[b.priority]?.order ?? 4
          cmp = orderA - orderB
          break
        }
        case 'assignee':
          cmp = (a.assignee ?? '').localeCompare(b.assignee ?? '')
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [tasks, sortKey, sortDir, columnMap])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) {
      return <ArrowUpDown className="size-3 text-muted-foreground/40" />
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="size-3 text-foreground" />
    ) : (
      <ArrowDown className="size-3 text-foreground" />
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground/60">No tasks yet</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-6 py-4">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              {([
                ['title', 'Title'],
                ['status', 'Status'],
                ['priority', 'Priority'],
                ['assignee', 'Assignee'],
              ] as const).map(([key, label]) => (
                <th
                  key={key}
                  className={cn(
                    'h-9 cursor-pointer select-none text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                    key === 'title' ? 'w-[40%] pl-3 pr-4' : 'px-3',
                    key === 'assignee' && 'w-[15%]',
                    key === 'status' && 'w-[20%]',
                    key === 'priority' && 'w-[15%]',
                  )}
                  onClick={() => handleSort(key)}
                >
                  <div className="flex items-center gap-1.5">
                    {label}
                    <SortIcon column={key} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTasks.map((task) => {
              const column = columnMap.get(task.column_id)
              const priority = priorityConfig[task.priority] ?? priorityConfig.none

              return (
                <tr
                  key={task.id}
                  className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50"
                  onClick={() => onTaskClick?.(task)}
                >
                  {/* Title */}
                  <td className="py-2.5 pl-3 pr-4">
                    <span className="text-sm font-medium text-foreground group-hover:text-foreground">
                      {task.title}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {column?.color && (
                        <span
                          className="inline-block size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: column.color }}
                        />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {column?.name ?? 'Unknown'}
                      </span>
                    </div>
                  </td>

                  {/* Priority */}
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                        priority.bg,
                      )}
                    >
                      <span className={cn('inline-block size-1.5 rounded-full', priority.color)} />
                      {priority.label}
                    </span>
                  </td>

                  {/* Assignee */}
                  <td className="px-3 py-2.5">
                    {task.assignee ? (
                      <div className="flex items-center gap-2">
                        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6rem] font-semibold text-muted-foreground">
                          {task.assignee.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {task.assignee}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground/40">--</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  )
}
