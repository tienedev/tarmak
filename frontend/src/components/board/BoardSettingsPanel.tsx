import { useState, useEffect } from 'react'
import { DrawerLayout } from '@/components/ui/drawer-layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useBoardStore } from '@/stores/board'
import { useNotificationStore } from '@/stores/notifications'
import { api, type InviteLink, type CustomField } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'
import {
  Users,
  Tag,
  Settings2,
  Gauge,
  Pencil,
  Trash2,
  Plus,
  Link2,
  Copy,
  Check,
  Hash,
  Type,
  Link as LinkIcon,
  Calendar,
  List,
} from 'lucide-react'

type SettingsTab = 'members' | 'labels' | 'fields' | 'wip' | 'danger'

interface BoardSettingsPanelProps {
  boardId: string
  open: boolean
  onClose: () => void
}

const tabs: { id: SettingsTab; label: string; icon: typeof Users }[] = [
  { id: 'members', label: 'Members', icon: Users },
  { id: 'labels', label: 'Labels', icon: Tag },
  { id: 'fields', label: 'Fields', icon: Settings2 },
  { id: 'wip', label: 'WIP Limits', icon: Gauge },
  { id: 'danger', label: 'Danger Zone', icon: Trash2 },
]

export function BoardSettingsPanel({ boardId, open, onClose }: BoardSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('members')

  return (
    <DrawerLayout
      open={open}
      onClose={onClose}
      title="Board Settings"
      width="560px"
      rawBody
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Vertical tab nav */}
        <nav className="flex w-36 shrink-0 flex-col gap-0.5 border-r px-2 py-3">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors text-left',
                  activeTab === tab.id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            )
          })}
        </nav>

        {/* Tab content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {activeTab === 'members' && <MembersTab boardId={boardId} />}
            {activeTab === 'labels' && <LabelsTab />}
            {activeTab === 'fields' && <FieldsTab />}
            {activeTab === 'wip' && <WipTab boardId={boardId} />}
            {activeTab === 'danger' && <DangerTab boardId={boardId} onClose={onClose} />}
          </div>
        </ScrollArea>
      </div>
    </DrawerLayout>
  )
}

// --- Members Tab ---

function MembersTab({ boardId }: { boardId: string }) {
  const { members } = useBoardStore()
  const user = useAuthStore((s) => s.user)
  const addNotification = useNotificationStore((s) => s.add)
  const [role, setRole] = useState('member')
  const [invites, setInvites] = useState<InviteLink[]>([])
  const [generatedLink, setGeneratedLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.listInvites(boardId).then(setInvites).catch(() => {
      addNotification('Failed to load invite links')
    })
  }, [boardId])

  const handleGenerate = async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await api.createInvite({ board_id: boardId, role })
      const fullUrl = `${window.location.origin}${window.location.pathname}#/invite${res.invite_url.replace('/invite', '')}`
      setGeneratedLink(fullUrl)
      const updated = await api.listInvites(boardId)
      setInvites(updated)
    } catch {
      addNotification('Failed to generate invite link')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeInvite(id)
      setInvites((prev) => prev.filter((i) => i.id !== id))
      if (generatedLink) setGeneratedLink('')
    } catch {
      addNotification('Failed to revoke invite')
    }
  }

  const daysLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Members & Roles</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Manage who has access to this board</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {member.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{member.name}</p>
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            </div>
            <Badge
              variant={member.role === 'admin' ? 'default' : 'secondary'}
              className="text-[0.6rem] capitalize"
            >
              {member.role}
            </Badge>
          </div>
        ))}
      </div>

      <Separator />

      <div>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Invite new member</h4>
        <div className="flex gap-2">
          <Select value={role} onValueChange={(v) => setRole(v ?? 'member')}>
            <SelectTrigger size="sm" className="flex-1">
              {role === 'member' ? 'Member' : 'Viewer'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleGenerate} disabled={loading}>
            <Link2 className="size-3.5" data-icon="inline-start" />
            Generate link
          </Button>
        </div>

        {generatedLink && (
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                {generatedLink}
              </code>
              <Button size="icon" variant="ghost" onClick={handleCopy} className="size-7 shrink-0">
                {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[0.65rem] text-muted-foreground">Link expires in 7 days</p>
          </div>
        )}
      </div>

      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">Active invite links</h4>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 text-xs">
              <code className="truncate text-muted-foreground">
                {inv.token.slice(0, 8)}...
              </code>
              <span className="text-muted-foreground">{inv.role}</span>
              <span className="text-muted-foreground/60">{daysLeft(inv.expires_at)}d left</span>
              <div className="flex-1" />
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                onClick={() => handleRevoke(inv.id)}
              >
                <Trash2 className="size-3 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Labels Tab ---

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
]

function LabelsTab() {
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
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Labels</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Organize tasks with color-coded labels</p>
      </div>

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

        {labels.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground/60">No labels yet</p>
        )}
      </div>

      <Separator />

      <div>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Add label</h4>
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
        <div className="mt-1.5 flex gap-1">
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
  )
}

// --- Fields Tab ---

const fieldTypeIcons: Record<string, typeof Type> = {
  text: Type,
  number: Hash,
  url: LinkIcon,
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

function FieldsTab() {
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
      await fetchBoard(currentBoard.id)
    } catch {
      addNotification('Failed to create field')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Custom Fields</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Fields appear on all tasks in this board</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {fields.length > 0 ? (
          fields.map((field: CustomField) => {
            const Icon = fieldTypeIcons[field.field_type] ?? Type
            return (
              <div
                key={field.id}
                className="flex items-center gap-2.5 rounded-md border border-border/60 px-3 py-2"
              >
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{field.name}</span>
                <Badge variant="secondary" className="text-[0.6rem]">
                  {fieldTypeLabels[field.field_type] ?? field.field_type}
                </Badge>
              </div>
            )
          })
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground/60">No custom fields yet</p>
        )}
      </div>

      <Separator />

      <div>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Add field</h4>
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
        <Button
          size="sm"
          className="mt-2"
          onClick={handleCreate}
          disabled={!newName.trim() || creating}
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          Add Field
        </Button>
      </div>
    </div>
  )
}

// --- WIP Limits Tab ---

function WipTab({ boardId }: { boardId: string }) {
  const { columns, fetchBoard } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [values, setValues] = useState<Record<string, string>>({})

  const activeColumns = columns.filter((c) => !c.archived).sort((a, b) => a.position - b.position)

  useEffect(() => {
    const initial: Record<string, string> = {}
    activeColumns.forEach((col) => {
      initial[col.id] = col.wip_limit?.toString() ?? ''
    })
    setValues(initial)
  }, [columns])

  const handleSave = async (columnId: string) => {
    const raw = values[columnId]?.trim()
    const val = raw === '' ? null : parseInt(raw, 10) || null
    try {
      await api.updateColumn(boardId, columnId, { wip_limit: val })
      await fetchBoard(boardId)
      addNotification('WIP limit updated')
    } catch {
      addNotification('Failed to update WIP limit')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">WIP Limits</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Limit the number of tasks in each column to improve flow
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {activeColumns.map((col) => (
          <div
            key={col.id}
            className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2"
          >
            {col.color && (
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: col.color }}
              />
            )}
            <span className="flex-1 text-sm font-medium">{col.name}</span>
            <Input
              type="number"
              min={0}
              value={values[col.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [col.id]: e.target.value }))}
              onBlur={() => handleSave(col.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(col.id) }}
              placeholder="∞"
              className="h-7 w-16 text-center text-sm"
            />
          </div>
        ))}
      </div>

      {activeColumns.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground/60">No columns yet</p>
      )}
    </div>
  )
}

// --- Danger Zone Tab ---

function DangerTab({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const { currentBoard, deleteBoard } = useBoardStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const boardName = currentBoard?.name ?? ''
  const confirmed = confirmText === boardName

  const handleDelete = async () => {
    if (!confirmed || deleting) return
    setDeleting(true)
    try {
      await deleteBoard(boardId)
      onClose()
      window.location.hash = '#/'
    } catch {
      addNotification('Failed to delete board')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-red-500">Delete Board</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This will permanently delete the board, all its columns, tasks, and attachments. This action cannot be undone.
        </p>
      </div>

      <Separator />

      <div>
        <p className="text-sm text-muted-foreground">
          Type <span className="font-semibold text-foreground">{boardName}</span> to confirm:
        </p>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDelete() }}
          placeholder={boardName}
          className="mt-2"
          autoComplete="off"
        />
      </div>

      <Button
        variant="destructive"
        disabled={!confirmed || deleting}
        onClick={handleDelete}
      >
        <Trash2 className="size-3.5" data-icon="inline-start" />
        {deleting ? 'Deleting...' : 'Delete this board'}
      </Button>
    </div>
  )
}
