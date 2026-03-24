import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, Square, GitBranch, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DrawerLayout } from '@/components/ui/drawer-layout'
import { api } from '@/lib/api'
import type { AgentSession } from '@/lib/api'
import { agentApi } from '@/lib/agent'
import { SESSION_STATUS_COLORS } from '@/lib/constants'
import { useAgentStore } from '@/stores/agent'
import { useBoardStore } from '@/stores/board'

interface BoardSessionsPanelProps {
  boardId: string
  open: boolean
  onClose: () => void
}

export function BoardSessionsPanel({ boardId, open, onClose }: BoardSessionsPanelProps) {
  const { t } = useTranslation()
  const { sessions, loading, fetchSessions, updateSession } = useAgentStore()
  const { tasks } = useBoardStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const hasRunning = sessions.some((s) => s.status === 'running')

  useEffect(() => {
    if (open) {
      fetchSessions(boardId)
    }
  }, [boardId, open, fetchSessions])

  // Poll every 3s while sessions are running and panel is open
  useEffect(() => {
    if (!open || !hasRunning) return
    const id = setInterval(() => fetchSessions(boardId), 3000)
    return () => clearInterval(id)
  }, [open, hasRunning, boardId, fetchSessions])

  const handleCancel = async (session: AgentSession) => {
    try {
      await agentApi.cancelSession(session.id)
      updateSession(session.id, { status: 'cancelled' })
    } catch {
      await api.cancelAgentSession(boardId, session.id)
      updateSession(session.id, { status: 'cancelled' })
    }
  }

  const toggleExpand = (sessionId: string) => {
    setExpandedId((prev) => (prev === sessionId ? null : sessionId))
  }

  const taskTitle = (taskId: string) => {
    const found = tasks.find((task) => task.id === taskId)
    return found?.title ?? taskId.slice(0, 8)
  }

  const runningSessions = sessions.filter((s) => s.status === 'running')
  const completedSessions = sessions.filter((s) => s.status !== 'running')

  return (
    <DrawerLayout
      open={open}
      onClose={onClose}
      title={t('agent.sessions')}
      description={t('agent.sessionCount', { count: sessions.length })}
      width="480px"
    >
      {loading && sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      )}

      {!loading && sessions.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <Terminal className="mx-auto mb-2 size-8 opacity-30" />
          <p>{t('agent.noSessions')}</p>
          <p className="text-xs mt-1">{t('agent.noSessionsHint')}</p>
        </div>
      )}

      {runningSessions.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('agent.running')}
          </h4>
          <div className="space-y-2">
            {runningSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                taskTitle={taskTitle(session.task_id)}
                expanded={expandedId === session.id}
                onToggle={() => toggleExpand(session.id)}
                onCancel={() => handleCancel(session)}
              />
            ))}
          </div>
        </div>
      )}

      {completedSessions.length > 0 && (
        <div>
          {runningSessions.length > 0 && (
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('agent.history')}
            </h4>
          )}
          <div className="space-y-2">
            {completedSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                taskTitle={taskTitle(session.task_id)}
                expanded={expandedId === session.id}
                onToggle={() => toggleExpand(session.id)}
              />
            ))}
          </div>
        </div>
      )}
    </DrawerLayout>
  )
}

function SessionRow({
  session,
  taskTitle,
  expanded,
  onToggle,
  onCancel,
}: {
  session: AgentSession
  taskTitle: string
  expanded: boolean
  onToggle: () => void
  onCancel?: () => void
}) {
  return (
    <div className="rounded-md border text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onToggle}>
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>

        <Badge variant="outline" className={SESSION_STATUS_COLORS[session.status]}>
          {session.status}
        </Badge>

        <span className="truncate text-xs font-medium">{taskTitle}</span>

        {session.branch_name && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="size-3" />
            <span className="truncate max-w-[120px]">{session.branch_name}</span>
          </span>
        )}

        <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
          {session.started_at &&
            formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
        </span>

        {session.status === 'running' && onCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-red-500 hover:text-red-600"
            onClick={onCancel}
          >
            <Square className="size-3.5" />
          </Button>
        )}
      </div>

      {expanded && <SessionDetail session={session} />}
    </div>
  )
}

function SessionDetail({ session }: { session: AgentSession }) {
  const { t } = useTranslation()
  if (session.status === 'running') {
    return (
      <div className="border-t px-3 py-3 text-xs text-muted-foreground">
        {t('agent.runningInTerminal')}
      </div>
    )
  }

  return (
    <div className="border-t">
      {session.exit_code !== null && (
        <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground border-b">
          <span>{t('agent.exitCode', { code: session.exit_code })}</span>
          {session.finished_at && (
            <span>
              {t('agent.finished', { time: formatDistanceToNow(new Date(session.finished_at), { addSuffix: true }) })}
            </span>
          )}
        </div>
      )}
      {session.log ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-3 py-2 text-xs text-zinc-300 font-mono">
          {session.log}
        </pre>
      ) : (
        <div className="px-3 py-3 text-xs text-muted-foreground italic">
          {t('agent.noLog')}
        </div>
      )}
    </div>
  )
}
