import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Column, Task } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TaskCard } from './TaskCard'
import { AddTaskForm } from './AddTaskForm'

interface KanbanColumnProps {
  column: Column
  tasks: Task[]
  boardId: string
  onTaskClick?: (task: Task) => void
}

export function KanbanColumn({ column, tasks, boardId, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  const sortedTasks = [...tasks].sort((a, b) => a.position - b.position)
  const taskIds = sortedTasks.map((t) => t.id)

  const isOverWipLimit =
    column.wip_limit != null && column.wip_limit > 0 && tasks.length >= column.wip_limit

  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col overflow-hidden rounded-xl bg-muted/50 transition-all',
        isOver && 'ring-2 ring-ring/30',
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        {column.color && (
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: column.color }}
          />
        )}
        <span className="flex-1 truncate text-xs font-semibold text-foreground">
          {column.name}
        </span>
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.6rem] font-semibold tabular-nums',
            isOverWipLimit
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {tasks.length}
          {column.wip_limit != null && column.wip_limit > 0 && (
            <span className="text-muted-foreground">/{column.wip_limit}</span>
          )}
        </span>
      </div>

      {/* WIP limit warning */}
      {isOverWipLimit && (
        <div className="mx-3 mt-1 rounded-md bg-red-50 px-2 py-0.5 text-[0.6rem] font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
          WIP limit reached
        </div>
      )}

      {/* Tasks list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-1">
        <div ref={setNodeRef} className="min-h-[2rem]">
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1.5 px-1">
              {sortedTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onClick={onTaskClick ? () => onTaskClick(task) : undefined}
                />
              ))}
            </div>
          </SortableContext>

          {/* Empty state */}
          {sortedTasks.length === 0 && (
            <p className="py-6 text-center text-[0.65rem] text-muted-foreground/60">
              No tasks yet
            </p>
          )}
        </div>

        {/* Add task button */}
        <div className="px-1 pt-1 pb-1">
          <AddTaskForm boardId={boardId} columnId={column.id} />
        </div>
      </div>
    </div>
  )
}
