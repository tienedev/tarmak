import { useState, useEffect, useCallback } from 'react'
import { api, type ActivityEntry, type BoardMember } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Plus,
  Pencil,
  ArrowRight,
  Trash2,
  MessageSquare,
  UserPlus,
  Columns3,
  Tag,
} from 'lucide-react'

const PAGE_SIZE = 50

const actionTypes = [
  { value: '__all__', label: 'All actions' },
  { value: 'task_created', label: 'Task created' },
  { value: 'task_updated', label: 'Task updated' },
  { value: 'task_moved', label: 'Task moved' },
  { value: 'task_deleted', label: 'Task deleted' },
  { value: 'column_created', label: 'Column created' },
  { value: 'column_updated', label: 'Column updated' },
  { value: 'column_deleted', label: 'Column deleted' },
  { value: 'comment_added', label: 'Comment added' },
  { value: 'member_joined', label: 'Member joined' },
  { value: 'field_created', label: 'Field created' },
  { value: 'field_value_set', label: 'Field value set' },
]

const actionIcons: Record<string, React.ReactNode> = {
  task_created: <Plus className="size-3.5" />,
  task_updated: <Pencil className="size-3.5" />,
  task_moved: <ArrowRight className="size-3.5" />,
  task_deleted: <Trash2 className="size-3.5" />,
  column_created: <Columns3 className="size-3.5" />,
  column_updated: <Columns3 className="size-3.5" />,
  column_deleted: <Columns3 className="size-3.5" />,
  comment_added: <MessageSquare className="size-3.5" />,
  member_joined: <UserPlus className="size-3.5" />,
  field_created: <Tag className="size-3.5" />,
  field_value_set: <Tag className="size-3.5" />,
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function safeParseDetails(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return {}
  } catch {
    return {}
  }
}

function renderAction(entry: ActivityEntry): React.ReactNode {
  const details = safeParseDetails(entry.details)
  const user = <span className="font-medium">{entry.user_name}</span>
  const title = details.title ? <span className="font-medium">{details.title}</span> : null
  const name = details.name ? <span className="font-medium">{details.name}</span> : null

  switch (entry.action) {
    case 'task_created':
      return <>{user} created {title}</>
    case 'task_updated':
      return <>{user} updated {title}</>
    case 'task_moved':
      return <>{user} moved {title}</>
    case 'task_deleted':
      return <>{user} deleted {title}</>
    case 'column_created':
      return <>{user} created column {name}</>
    case 'column_updated':
      return <>{user} updated a column</>
    case 'column_deleted':
      return <>{user} deleted a column</>
    case 'comment_added':
      return <>{user} commented on a task</>
    case 'member_joined':
      return <>{user} joined the board</>
    case 'field_created':
      return <>{user} added field {name}</>
    case 'field_value_set':
      return <>{user} set {details.field_name ? <span className="font-medium">{details.field_name}</span> : 'a field'}</>
    default:
      return <>{user} performed {entry.action}</>
  }
}

interface ActivityPanelProps {
  boardId: string
  open: boolean
  onClose: () => void
  members: BoardMember[]
}

export function ActivityPanel({ boardId, open, onClose, members }: ActivityPanelProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [actionFilter, setActionFilter] = useState('__all__')
  const [userFilter, setUserFilter] = useState('__all__')

  const fetchEntries = useCallback(
    async (offset = 0, append = false) => {
      setLoading(true)
      try {
        const params: { limit: number; offset: number; action?: string; user_id?: string } = {
          limit: PAGE_SIZE,
          offset,
        }
        if (actionFilter !== '__all__') params.action = actionFilter
        if (userFilter !== '__all__') params.user_id = userFilter
        const data = await api.listActivity(boardId, params)
        setEntries((prev) => (append ? [...prev, ...data] : data))
        setHasMore(data.length === PAGE_SIZE)
      } catch {
        setEntries((prev) => (append ? prev : []))
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [boardId, actionFilter, userFilter],
  )

  useEffect(() => {
    if (open) {
      fetchEntries(0, false)
    }
  }, [open, fetchEntries])

  const loadMore = () => {
    fetchEntries(entries.length, true)
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden sm:max-w-[380px]">
        <SheetHeader className="shrink-0 pb-3">
          <SheetTitle className="text-base">Activity</SheetTitle>
          <SheetDescription className="sr-only">Board activity feed</SheetDescription>
        </SheetHeader>

        {/* Filters */}
        <div className="flex gap-2 pb-3">
          <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? '__all__')}>
            <SelectTrigger size="sm" className="flex-1 pl-2.5 text-xs">
              {actionTypes.find((t) => t.value === actionFilter)?.label ?? 'All actions'}
            </SelectTrigger>
            <SelectContent>
              {actionTypes.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={userFilter} onValueChange={(v) => setUserFilter(v ?? '__all__')}>
            <SelectTrigger size="sm" className="flex-1 pl-2.5 text-xs">
              {userFilter === '__all__'
                ? 'All users'
                : members.find((m) => m.id === userFilter)?.name ?? 'All users'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">All users</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Feed */}
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 pr-3">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {actionIcons[entry.action] ?? <Pencil className="size-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-foreground">
                    {renderAction(entry)}
                  </p>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground/60">
                    {relativeTime(entry.created_at)}
                  </p>
                </div>
              </div>
            ))}

            {entries.length === 0 && !loading && (
              <p className="py-8 text-center text-xs text-muted-foreground/50">No activity yet</p>
            )}

            {hasMore && entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mx-auto mt-2 text-xs"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load more'}
              </Button>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
