import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, Square, GitBranch, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/lib/api'
import type { AgentSession } from '@/lib/api'
import { agentApi } from '@/lib/agent'
import { SESSION_STATUS_COLORS } from '@/lib/constants'
import { useAgentStore } from '@/stores/agent'
import { useBoardStore } from '@/stores/board'

interface SessionsViewProps {
  boardId: string
}

export function SessionsView({ boardId }: SessionsViewProps) {
  const { t } = useTranslation()
  const { sessions, loading, fetchSessions, updateSession } = useAgentStore()
  const { tasks } = useBoardStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const hasRunning = sessions.some((s) => s.status === 'running')

  useEffect(() => {
    fetchSessions(boardId)
  }, [boardId, fetchSessions])

  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => fetchSessions(boardId), 3000)
    return () => clearInterval(id)
  }, [hasRunning, boardId, fetchSessions])

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
    const task = tasks.find((t) => t.id === taskId)
    return task?.title ?? taskId.slice(0, 8)
  }

  const runningSessions = sessions.filter((s) => s.status === 'running')
  const completedSessions = sessions.filter((s) => s.status !== 'running')

  if (loading && sessions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (!loading && sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <Terminal className="size-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">{t('agent.noSessions')}</p>
        <p className="text-xs text-muted-foreground">{t('agent.noSessionsHint')}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-6">
        {runningSessions.length > 0 && (
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('agent.running')} ({runningSessions.length})
            </h3>
            <div className="space-y-2">
              {runningSessions.map((session) => (
                <SessionCard
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
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('agent.history')} ({completedSessions.length})
            </h3>
            <div className="space-y-2">
              {completedSessions.map((session) => (
                <SessionCard
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
      </div>
    </ScrollArea>
  )
}

function SessionCard({
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
  const { t } = useTranslation()

  return (
    <div className="rounded-xl border bg-card text-sm shadow-sm">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={onToggle}>
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>

        <Badge variant="outline" className={SESSION_STATUS_COLORS[session.status]}>
          {session.status}
        </Badge>

        <span className="truncate text-sm font-medium">{taskTitle}</span>

        {session.branch_name && (
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="size-3" />
            <span className="truncate max-w-[160px]">{session.branch_name}</span>
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

      {expanded && (
        <div className="border-t">
          {session.status === 'running' ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              {t('agent.runningInTerminal')}
            </div>
          ) : (
            <>
              {session.exit_code !== null && (
                <div className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground border-b">
                  <span>{t('agent.exitCode', { code: session.exit_code })}</span>
                  {session.finished_at && (
                    <span>
                      {t('agent.finished', { time: formatDistanceToNow(new Date(session.finished_at), { addSuffix: true }) })}
                    </span>
                  )}
                </div>
              )}
              {session.log ? (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-4 py-3 text-xs text-zinc-300 font-mono rounded-b-xl">
                  {session.log}
                </pre>
              ) : (
                <div className="px-4 py-3 text-xs text-muted-foreground italic">
                  {t('agent.noLog')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
