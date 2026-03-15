import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import { Tag, Pencil, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

export function LabelManager() {
  const { currentBoard, labels, createLabel, updateLabel, deleteLabel } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  if (!currentBoard) return null

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await createLabel(currentBoard.id, newName.trim(), newColor)
      setNewName('')
      addNotification('Label created')
    } catch {
      addNotification('Failed to create label')
    }
  }

  const handleUpdate = async (id: string) => {
    try {
      await updateLabel(currentBoard.id, id, { name: editName, color: editColor })
      setEditingId(null)
    } catch {
      addNotification('Failed to update label')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteLabel(currentBoard.id, id)
      addNotification('Label deleted')
    } catch {
      addNotification('Failed to delete label')
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="size-8" />
        }
      >
        <Tag className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <h3 className="mb-2 text-sm font-medium">Board Labels</h3>
        <div className="flex flex-col gap-1">
          {labels.map((label) => (
            <div key={label.id} className="group flex items-center gap-2 rounded px-1 py-1">
              {editingId === label.id ? (
                <div className="flex flex-1 flex-col gap-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(label.id) }}
                    className="h-7 text-sm"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn('size-4 rounded-full border-2', editColor === c ? 'border-foreground' : 'border-transparent')}
                        style={{ backgroundColor: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => handleUpdate(label.id)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="size-3 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="flex-1 text-sm">{label.name}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    onClick={() => { setEditingId(label.id); setEditName(label.name); setEditColor(label.color) }}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(label.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-1 border-t pt-2">
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex gap-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="New label..."
                className="h-7 flex-1 text-sm"
              />
              <Button size="sm" className="h-7" onClick={handleCreate} disabled={!newName.trim()}>
                <Plus className="size-3.5" />
              </Button>
            </div>
            <div className="flex gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn('size-4 rounded-full border-2', newColor === c ? 'border-foreground' : 'border-transparent')}
                  style={{ backgroundColor: c }}
                  onClick={() => setNewColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
