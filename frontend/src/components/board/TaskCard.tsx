import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '@/lib/api'
import { cn } from '@/lib/utils'

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-zinc-400',
  none: 'bg-zinc-300',
}

const priorityLabels: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

interface TaskCardProps {
  task: Task
  overlay?: boolean
  onClick?: () => void
}

export function TaskCard({ task, overlay, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const priorityDot = priorityColors[task.priority] ?? priorityColors.none

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group/card cursor-grab rounded-lg border border-border/60 bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all',
        'hover:shadow-md hover:border-border',
        'active:cursor-grabbing',
        isDragging && 'opacity-50',
        overlay && 'rotate-[2deg] shadow-lg border-border',
      )}
    >
      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">
        {task.title}
      </p>

      {/* Metadata row */}
      <div className="mt-2 flex items-center gap-2">
        {/* Priority dot + label */}
        {task.priority && task.priority !== 'none' && (
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                priorityDot,
              )}
            />
            <span className="text-[0.65rem] font-medium text-muted-foreground">
              {priorityLabels[task.priority] ?? task.priority}
            </span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Assignee avatar */}
        {task.assignee && (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6rem] font-semibold text-muted-foreground">
            {task.assignee.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskCardOverlay({ task }: { task: Task }) {
  return <TaskCard task={task} overlay />
}
