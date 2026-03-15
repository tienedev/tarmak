import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { Task, Comment } from '@/lib/api'
import { api } from '@/lib/api'
import { useBoardStore } from '@/stores/board'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { TiptapEditor } from '@/components/editor/TiptapEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { CustomFieldValue } from '@/components/fields/CustomFieldValue'
import { cn } from '@/lib/utils'
import {
  Trash2,
  Send,
  ChevronRight,
  User as UserIcon,
} from 'lucide-react'
import { LabelPicker } from '@/components/board/LabelPicker'
import { SubtaskList } from '@/components/board/SubtaskList'

const priorityOptions = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-zinc-400',
  none: 'bg-zinc-300',
}

interface TaskEditorProps {
  task: Task
  onClose: () => void
}

export function TaskEditor({ task, onClose }: TaskEditorProps) {
  const { currentBoard, columns, fields, members, updateTask, deleteTask } = useBoardStore()
  const user = useAuthStore((s) => s.user)
  const addNotification = useNotificationStore((s) => s.add)

  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [assignee, setAssignee] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [saving, setSaving] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync state when task changes
  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description ?? '')
    setPriority(task.priority ?? 'none')
    setAssignee(task.assignee ?? '')
    setEditingTitle(false)
    setFieldValues({})
    setComments([])

    if (currentBoard) {
      api.getFieldValues(currentBoard.id, task.id)
        .then((vals) => {
          const map: Record<string, string> = {}
          for (const v of vals) map[v.field_id] = v.value
          setFieldValues(map)
        })
        .catch(() => {})
      api.listComments(currentBoard.id, task.id).then(setComments).catch(() => {
        addNotification('Failed to load comments')
      })
    }
  }, [task.id, currentBoard])

  const saveField = useCallback(
    async (data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>) => {
      if (!currentBoard) return
      setSaving(true)
      try {
        await updateTask(currentBoard.id, task.id, data)
      } finally {
        setSaving(false)
      }
    },
    [task, currentBoard, updateTask],
  )

  const debouncedSave = useCallback(
    (data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => saveField(data), 600)
    },
    [saveField],
  )

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (title.trim() && title !== task.title) {
      saveField({ title: title.trim() })
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleBlur()
    }
    if (e.key === 'Escape') {
      setTitle(task.title)
      setEditingTitle(false)
    }
  }

  const handleDescriptionChange = (value: string) => {
    setDescription(value)
    if (value !== (task.description ?? '')) {
      debouncedSave({ description: value })
    }
  }

  const handlePriorityChange = (value: string | null) => {
    const v = value ?? 'none'
    setPriority(v)
    saveField({ priority: v })
  }

  const handleAssigneeChange = (value: string) => {
    const v = value === '__unassigned__' ? '' : value
    setAssignee(v)
    saveField({ assignee: v || undefined })
  }

  const handleFieldChange = useCallback(
    (fieldId: string, value: string) => {
      setFieldValues((prev) => ({ ...prev, [fieldId]: value }))
      if (!currentBoard) return
      api.setFieldValue(currentBoard.id, task.id, fieldId, value).catch(() => {
        addNotification('Failed to save field value')
      })
    },
    [currentBoard, task.id, addNotification],
  )

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentBoard || !user || submittingComment) return
    setSubmittingComment(true)
    try {
      const comment = await api.createComment(currentBoard.id, task.id, {
        content: newComment.trim(),
      })
      setComments((prev) => [...prev, comment])
      setNewComment('')
      addNotification(`Comment added to "${task.title}"`)
    } catch {
      addNotification('Failed to add comment')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleDelete = async () => {
    if (!currentBoard) return
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return
    const taskTitle = task.title
    try {
      await deleteTask(currentBoard.id, task.id)
      addNotification(`Deleted task "${taskTitle}"`)
      onClose()
    } catch {
      addNotification('Failed to delete task')
    }
  }

  const column = columns.find((c) => c.id === task.column_id)

  function formatTimestamp(ts: string) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex flex-col gap-0 px-8 py-6">
      {/* Title — large, editable inline */}
      <div className="mb-6">
        {editingTitle ? (
          <Input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            className="h-auto border-0 bg-transparent p-0 text-2xl font-bold shadow-none focus-visible:ring-0"
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="w-full cursor-text text-left text-2xl font-bold tracking-tight hover:text-foreground/80"
            onClick={() => {
              setEditingTitle(true)
              setTimeout(() => titleInputRef.current?.focus(), 0)
            }}
          >
            {title || 'Untitled task'}
          </button>
        )}
      </div>

      {/* Property rows — grid layout */}
      <div className="mb-6 grid grid-cols-[8rem_1fr] gap-y-3 gap-x-4 text-sm">
        {/* Status */}
        {column && (
          <>
            <span className="text-muted-foreground">Status</span>
            <span className="flex items-center gap-2">
              {column.color && (
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: column.color }}
                />
              )}
              {column.name}
            </span>
          </>
        )}

        {/* Priority */}
        <span className="text-muted-foreground">Priority</span>
        <div>
          <Select value={priority} onValueChange={handlePriorityChange}>
            <SelectTrigger
              size="sm"
              className="h-7 w-auto min-w-[7rem] border-0 bg-transparent pl-1 pr-2 shadow-none focus:ring-0"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block size-2 rounded-full',
                    priorityColors[priority] ?? priorityColors.none,
                  )}
                />
                {priorityOptions.find((o) => o.value === priority)?.label ?? 'None'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-block size-2 rounded-full',
                        priorityColors[opt.value],
                      )}
                    />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Assignee */}
        <span className="text-muted-foreground">Assignee</span>
        <div>
          <Select value={assignee || '__unassigned__'} onValueChange={(v) => handleAssigneeChange(v ?? '__unassigned__')}>
            <SelectTrigger
              size="sm"
              className="h-7 w-auto min-w-[7rem] border-0 bg-transparent pl-1 pr-2 shadow-none focus:ring-0"
            >
              <span className="flex items-center gap-2">
                <UserIcon className="size-3.5 text-muted-foreground" />
                <span className={assignee ? '' : 'text-muted-foreground'}>
                  {assignee || 'Unassigned'}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">
                <span className="text-muted-foreground">Unassigned</span>
              </SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.name}>
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold uppercase text-muted-foreground">
                      {m.name.slice(0, 2)}
                    </span>
                    {m.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Labels */}
        <span className="text-muted-foreground">Labels</span>
        <div>
          <LabelPicker taskId={task.id} taskLabels={task.labels ?? []} />
        </div>

        {/* Due date */}
        <span className="text-muted-foreground">Due date</span>
        <div>
          <input
            type="date"
            value={task.due_date ?? ''}
            onChange={(e) => {
              const val = e.target.value || null
              saveField({ due_date: val } as Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>)
            }}
            className="h-7 rounded border-0 bg-transparent px-1 text-sm shadow-none focus:ring-0"
          />
        </div>

        {/* Created */}
        <span className="text-muted-foreground">Created</span>
        <span className="text-muted-foreground/70">{formatTimestamp(task.created_at)}</span>

        {/* Updated */}
        {task.updated_at !== task.created_at && (
          <>
            <span className="text-muted-foreground">Updated</span>
            <span className="text-muted-foreground/70">{formatTimestamp(task.updated_at)}</span>
          </>
        )}

        {/* Custom fields as additional property rows */}
        {fields.map((field) => (
          <React.Fragment key={field.id}>
            <span className="truncate text-muted-foreground">{field.name}</span>
            <div>
              <CustomFieldValue
                field={field}
                value={fieldValues[field.id] ?? ''}
                onChange={(v) => handleFieldChange(field.id, v)}
              />
            </div>
          </React.Fragment>
        ))}
      </div>

      <Separator className="mb-6" />

      {/* Description — borderless Tiptap editor */}
      <div className="mb-6 min-h-[12rem]">
        <TiptapEditor
          content={description}
          onChange={handleDescriptionChange}
        />
      </div>

      <SubtaskList taskId={task.id} />

      <Separator className="mb-4" />

      {/* Comments — collapsible */}
      <div className="mb-6">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setCommentsOpen(!commentsOpen)}
        >
          <ChevronRight
            className={cn(
              'size-4 transition-transform',
              commentsOpen && 'rotate-90',
            )}
          />
          Comments
          {comments.length > 0 && (
            <Badge variant="secondary" className="text-[0.6rem]">
              {comments.length}
            </Badge>
          )}
        </button>

        {commentsOpen && (
          <div className="mt-3 flex flex-col gap-3 pl-6">
            {comments.length > 0 ? (
              <div className="flex flex-col gap-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="rounded-lg bg-muted/50 px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <div className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.55rem] font-semibold uppercase text-muted-foreground">
                        {(comment.user_name ?? comment.user_id ?? '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-[0.65rem] text-muted-foreground">
                        {formatTimestamp(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{comment.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">No comments yet</p>
            )}

            <div className="flex gap-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleAddComment()
                  }
                }}
                placeholder="Add a comment..."
                className="flex-1 text-sm"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={handleAddComment}
                disabled={!newComment.trim() || submittingComment}
              >
                <Send className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer — save status + delete */}
      <Separator />
      <div className="flex items-center justify-between py-4">
        <div className="text-xs text-muted-foreground">
          {saving ? 'Saving...' : 'Auto-saved'}
        </div>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}
