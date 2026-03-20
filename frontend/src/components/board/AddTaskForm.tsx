import { useState, useRef, useEffect } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBoardStore } from '@/stores/board'

interface AddTaskFormProps {
  boardId: string
  columnId: string
}

export function AddTaskForm({ boardId, columnId }: AddTaskFormProps) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('none')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const createTask = useBoardStore((s) => s.createTask)

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      await createTask(boardId, columnId, trimmed, priority === 'none' ? undefined : priority)
      setTitle('')
      setPriority('none')
      setExpanded(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setTitle('')
      setPriority('none')
      setExpanded(false)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-all hover:bg-foreground/[5%] hover:text-foreground"
      >
        <Plus className="size-3.5" />
        <span>Add task</span>
      </button>
    )
  }

  return (
    <div ref={formRef} className="flex flex-col gap-2 rounded-xl glass-border bg-card p-2 backdrop-blur-md shadow-sm">
      <Input
        ref={inputRef}
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 border-0 bg-transparent px-1.5 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center gap-1.5">
        <Select value={priority} onValueChange={(v) => setPriority(v ?? 'none')}>
          <SelectTrigger size="sm" className="h-6 min-w-0 gap-1 border-[var(--glass-border)] px-1.5 text-xs">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setTitle('')
            setPriority('none')
            setExpanded(false)
          }}
          className="h-6 text-xs text-muted-foreground"
        >
          Cancel
        </Button>
        <Button
          size="xs"
          onClick={handleSubmit}
          disabled={!title.trim() || submitting}
          className="h-6 text-xs"
        >
          {submitting && <Loader2 className="size-3 animate-spin" />}
          {submitting ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  )
}
