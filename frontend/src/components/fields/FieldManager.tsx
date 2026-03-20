import { useState } from 'react'
import type { CustomField } from '@/lib/api'
import { api } from '@/lib/api'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { Plus, Hash, Type, Link, Calendar, List } from 'lucide-react'

const fieldTypeIcons: Record<string, typeof Type> = {
  text: Type,
  number: Hash,
  url: Link,
  date: Calendar,
  enum: List,
}

const fieldTypeLabels: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  url: 'URL',
  date: 'Date',
  enum: 'Enum',
}

interface FieldManagerProps {
  open: boolean
  onClose: () => void
}

export function FieldManager({ open, onClose }: FieldManagerProps) {
  const { currentBoard, fields, fetchBoard } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('text')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!newName.trim() || !currentBoard || creating) return
    setCreating(true)
    try {
      await api.createField(currentBoard.id, {
        name: newName.trim(),
        field_type: newType,
      })
      setNewName('')
      setNewType('text')
      addNotification(`Field "${newName.trim()}" created`)
      // Refresh board to get updated fields
      await fetchBoard(currentBoard.id)
    } catch {
      addNotification('Failed to create field')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Custom Fields</DialogTitle>
          <DialogDescription>
            Manage custom fields for this board. Fields appear on all tasks.
          </DialogDescription>
        </DialogHeader>

        {/* Current fields */}
        <div className="flex flex-col gap-2">
          {fields.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {fields.map((field: CustomField) => {
                const Icon = fieldTypeIcons[field.field_type] ?? Type
                return (
                  <div
                    key={field.id}
                    className="flex items-center gap-2.5 rounded-md border border-border/60 px-3 py-2"
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm font-medium">
                      {field.name}
                    </span>
                    <Badge variant="secondary" className="text-[0.6rem]">
                      {fieldTypeLabels[field.field_type] ?? field.field_type}
                    </Badge>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground/60">
              No custom fields yet
            </p>
          )}
        </div>

        <Separator />

        {/* Add new field */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Add field
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreate()
                }
              }}
              placeholder="Field name..."
              className="flex-1 text-sm"
            />
            <Select value={newType} onValueChange={(v) => setNewType(v ?? 'text')}>
              <SelectTrigger size="sm" className="w-24">
                {fieldTypeLabels[newType] ?? 'Text'}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="url">URL</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            Add Field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
