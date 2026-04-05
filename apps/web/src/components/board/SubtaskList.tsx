import { useState, useEffect } from 'react'
import { trpcClient } from '@/lib/trpc'
import type { Subtask } from '@/lib/types'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import { Input } from '@/components/ui/input'
import { ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SubtaskListProps {
  taskId: string
}

export function SubtaskList({ taskId }: SubtaskListProps) {
  const { currentBoard } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [open, setOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (!currentBoard) return
    trpcClient.subtask.list.query({ taskId }).then((s) => setSubtasks(s as Subtask[])).catch(() => {})
  }, [currentBoard, taskId])

  if (!currentBoard) return null

  const completed = subtasks.filter((s) => s.completed).length
  const total = subtasks.length

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    try {
      const subtask = await trpcClient.subtask.create.mutate({ taskId, title: newTitle.trim() }) as Subtask
      setSubtasks((prev) => [...prev, subtask])
      setNewTitle('')
    } catch {
      addNotification('Failed to add subtask')
    }
  }

  const handleToggle = async (subtask: Subtask) => {
    try {
      const updated = await trpcClient.subtask.toggle.mutate({ subtaskId: subtask.id }) as Subtask
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? updated : s)))
    } catch {
      addNotification('Failed to update subtask')
    }
  }

  const handleDelete = async (subtaskId: string) => {
    try {
      await trpcClient.subtask.delete.mutate({ subtaskId })
      setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId))
    } catch {
      addNotification('Failed to delete subtask')
    }
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        Subtasks
        {total > 0 && (
          <span className="text-xs text-muted-foreground/70">
            ({completed}/{total})
          </span>
        )}
      </button>

      {total > 0 && (
        <div className="mt-1 ml-6 h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-1 pl-6">
          {subtasks.map((subtask) => (
            <div key={subtask.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/30">
              <input
                type="checkbox"
                checked={subtask.completed}
                onChange={() => handleToggle(subtask)}
                className="size-4 rounded border-muted-foreground/30"
              />
              <span className={cn('flex-1 text-sm', subtask.completed && 'text-muted-foreground line-through')}>
                {subtask.title}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(subtask.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}

          <div className="mt-1">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder="Add subtask..."
              className="h-7 text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}
