import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LABEL_PALETTE } from '@/lib/constants'
import type { Label } from '@/lib/types'

interface LabelPickerProps {
  taskId: string
  taskLabels: Label[]
}

export function LabelPicker({ taskId, taskLabels }: LabelPickerProps) {
  const { currentBoard, labels, createLabel, addTaskLabel, removeTaskLabel } = useBoardStore()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(LABEL_PALETTE[0])

  if (!currentBoard) return null

  const taskLabelIds = new Set(taskLabels.map((l) => l.id))

  const toggle = async (labelId: string) => {
    if (taskLabelIds.has(labelId)) {
      await removeTaskLabel(currentBoard.id, taskId, labelId)
    } else {
      await addTaskLabel(currentBoard.id, taskId, labelId)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const label = await createLabel(currentBoard.id, newName.trim(), newColor)
    await addTaskLabel(currentBoard.id, taskId, label.id)
    setNewName('')
    setCreating(false)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex flex-wrap items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/50"
          />
        }
      >
        {taskLabels.length > 0 ? (
          taskLabels.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: l.color }}
            >
              {l.name}
            </span>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">Add labels...</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex flex-col gap-1">
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50',
                taskLabelIds.has(label.id) && 'bg-muted',
              )}
              onClick={() => toggle(label.id)}
            >
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
              {taskLabelIds.has(label.id) && (
                <svg className="ml-auto size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              )}
            </button>
          ))}

          {creating ? (
            <div className="mt-1 flex flex-col gap-2 border-t pt-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="Label name"
                className="h-7 text-sm"
                autoFocus
              />
              <div className="flex gap-1">
                {LABEL_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      'size-5 rounded-full border-2',
                      newColor === c ? 'border-foreground' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 flex-1 text-xs" onClick={handleCreate}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-1 flex items-center gap-2 border-t pt-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" />
              Create label
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
