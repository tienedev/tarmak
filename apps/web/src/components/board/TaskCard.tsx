import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task, AgentSession } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isLightColor } from '@/lib/color'
import { SessionIndicator } from './SessionIndicator'
import type { LucideIcon } from 'lucide-react'
import {
  GripVertical,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
  Calendar,
  Paperclip,
} from 'lucide-react'

const priorityConfig: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus, color: 'text-yellow-500', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-zinc-400', label: 'Low' },
}

interface TaskCardProps {
  task: Task
  overlay?: boolean
  onClick?: () => void
  latestSession?: AgentSession
}

export function TaskCard({ task, overlay, onClick, latestSession }: TaskCardProps) {
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

  const priorityCfg = task.priority && task.priority !== 'none'
    ? priorityConfig[task.priority]
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      onClick={onClick}
      className={cn(
        'group/card cursor-pointer rounded-xl glass-border p-3 transition-all',
        'bg-card backdrop-blur-md',
        'shadow-[inset_0_1px_0_oklch(1_0_0/20%),0_1px_3px_oklch(0_0_0/4%)]',
        'hover:shadow-[inset_0_1px_0_oklch(1_0_0/25%),0_2px_8px_oklch(0_0_0/8%)]',
        isDragging && 'opacity-40',
        overlay && 'rotate-[2deg] shadow-[inset_0_1px_0_oklch(1_0_0/20%),0_8px_24px_oklch(0_0_0/12%)]',
      )}
    >
      {/* Drag handle + Title */}
      <div className="flex items-start gap-1.5">
        <span
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 cursor-grab shrink-0 text-muted-foreground/0 transition-colors group-hover/card:text-muted-foreground/40 active:cursor-grabbing"
          aria-label="Drag to reorder"
          role="button"
          tabIndex={0}
        >
          <GripVertical className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {task.title}
        </p>
      </div>

      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium shadow-sm',
                isLightColor(label.color) ? 'text-gray-900' : 'text-white',
              )}
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-[0.65rem] text-muted-foreground">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Metadata row */}
      <div className="mt-2 flex items-center gap-2">
        {/* Agent session indicator */}
        <SessionIndicator session={latestSession} />

        {/* Priority icon */}
        {priorityCfg && (
          <div className={cn('flex items-center gap-1', priorityCfg.color)} title={priorityCfg.label}>
            <priorityCfg.icon className="size-3" />
            <span className="text-[0.65rem] font-medium">{priorityCfg.label}</span>
          </div>
        )}

        {/* Subtask progress */}
        {task.subtask_count && task.subtask_count.total > 0 && (
          <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
            <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 8l4 4 8-8" />
            </svg>
            {task.subtask_count.completed}/{task.subtask_count.total}
          </div>
        )}

        {/* Attachment count */}
        {task.attachment_count != null && task.attachment_count > 0 && (
          <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground">
            <Paperclip className="size-3" />
            {task.attachment_count}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Due date */}
        {task.due_date && (
          <div className={cn(
            'flex items-center gap-1 text-[0.65rem] font-medium',
            new Date(task.due_date) < new Date() ? 'text-red-500' :
            // eslint-disable-next-line react-hooks/purity
            new Date(task.due_date).getTime() - Date.now() < 2 * 86400000 ? 'text-orange-500' :
            'text-muted-foreground',
          )}>
            <Calendar className="size-3" />
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}

        {/* Assignee avatar */}
        {task.assignee && (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.65rem] font-semibold text-primary">
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
