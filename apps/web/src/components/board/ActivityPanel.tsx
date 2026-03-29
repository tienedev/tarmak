import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type ActivityEntry, type BoardMember } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { DrawerLayout } from '@/components/ui/drawer-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Plus,
  Pencil,
  ArrowRight,
  Trash2,
  MessageSquare,
  UserPlus,
  Columns3,
  Tag,
  Bot,
} from 'lucide-react'

const PAGE_SIZE = 50

const ACTION_TYPE_KEYS: { value: string; key: string }[] = [
  { value: '__all__', key: 'activity.allActions' },
  { value: 'task_created', key: 'activity.taskCreated' },
  { value: 'task_updated', key: 'activity.taskUpdated' },
  { value: 'task_moved', key: 'activity.taskMoved' },
  { value: 'task_deleted', key: 'activity.taskDeleted' },
  { value: 'column_created', key: 'activity.columnCreated' },
  { value: 'column_updated', key: 'activity.columnUpdated' },
  { value: 'column_deleted', key: 'activity.columnDeleted' },
  { value: 'comment_added', key: 'activity.commentAdded' },
  { value: 'member_joined', key: 'activity.memberJoined' },
  { value: 'field_created', key: 'activity.fieldCreated' },
  { value: 'field_value_set', key: 'activity.fieldValueSet' },
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
  const { t } = useTranslation()
  const actionTypes = ACTION_TYPE_KEYS.map((a) => ({ value: a.value, label: t(a.key) }))
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [actionFilter, setActionFilter] = useState('__all__')
  const [userFilter, setUserFilter] = useState('__all__')
  const [agentFilter, setAgentFilter] = useState<'all' | 'humans' | 'agents'>('all')

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

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Select value={actionFilter} onValueChange={(v) => setActionFilter(v ?? '__all__')}>
          <SelectTrigger size="sm" className="flex-1 pl-2.5 text-xs">
            {actionTypes.find((at) => at.value === actionFilter)?.label ?? t('activity.allActions')}
          </SelectTrigger>
          <SelectContent>
            {actionTypes.map((at) => (
              <SelectItem key={at.value} value={at.value} className="text-xs">
                {at.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userFilter} onValueChange={(v) => setUserFilter(v ?? '__all__')}>
          <SelectTrigger size="sm" className="flex-1 pl-2.5 text-xs">
            {userFilter === '__all__'
              ? t('activity.allUsers')
              : members.find((m) => m.id === userFilter)?.name ?? t('activity.allUsers')}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">{t('activity.allUsers')}</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-1">
        {(['all', 'humans', 'agents'] as const).map((f) => (
          <Button
            key={f}
            variant={agentFilter === f ? 'default' : 'outline'}
            size="xs"
            className="text-xs capitalize"
            onClick={() => setAgentFilter(f)}
          >
            {f === 'agents' && <Bot className="mr-1 size-3" />}
            {f === 'all' ? t('common.all') : f === 'humans' ? t('activity.humans') : t('activity.agents')}
          </Button>
        ))}
      </div>
    </div>
  )

  return (
    <DrawerLayout open={open} onClose={onClose} title={t('activity.title')} toolbar={toolbar}>
      <div className="flex flex-col gap-1">
        {entries
          .filter((e) => {
            if (agentFilter === 'humans') return !e.is_agent
            if (agentFilter === 'agents') return e.is_agent
            return true
          })
          .map((entry) => (
          <div key={entry.id} className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
            <div
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                entry.is_agent
                  ? 'bg-violet-100 text-violet-600'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {entry.is_agent
                ? <Bot className="size-3.5" />
                : (actionIcons[entry.action] ?? <Pencil className="size-3.5" />)}
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
          <p className="py-8 text-center text-xs text-muted-foreground/50">{t('activity.noActivity')}</p>
        )}

        {hasMore && entries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto mt-2 text-xs"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('activity.loadMore')}
          </Button>
        )}
      </div>
    </DrawerLayout>
  )
}
