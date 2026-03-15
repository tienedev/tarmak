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
        'flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl glass-subtle glass-border transition-all',
        isOver && 'ring-2 ring-ring/30',
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        {column.color && (
          <span
            className="inline-block size-2.5 rounded-full shadow-sm"
            style={{ backgroundColor: column.color }}
          />
        )}
        <span className="flex-1 truncate text-xs font-bold text-foreground">
          {column.name}
        </span>
        <span
          className={cn(
            'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 text-[0.6rem] font-bold tabular-nums',
            isOverWipLimit
              ? 'bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-400'
              : 'bg-foreground/6 text-muted-foreground',
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
        <div className="mx-3 mt-1 rounded-lg bg-red-500/10 px-2 py-0.5 text-[0.6rem] font-medium text-red-600 dark:text-red-400">
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
            <div className="flex flex-col items-center gap-1 py-6 text-center">
              <p className="text-[0.65rem] font-medium text-muted-foreground/50">
                No tasks yet
              </p>
              <p className="text-[0.65rem] text-muted-foreground/35">
                Click "Add task" below
              </p>
            </div>
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
