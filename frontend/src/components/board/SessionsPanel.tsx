import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, Square, GitBranch, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import type { AgentSession } from '@/lib/api'
import { agentApi } from '@/lib/agent'
import { useAgentStore } from '@/stores/agent'

interface SessionsPanelProps {
  boardId: string
  taskId: string
}

const statusColors: Record<string, string> = {
  running: 'bg-green-500/10 text-green-500',
  success: 'bg-emerald-500/10 text-emerald-500',
  failed: 'bg-red-500/10 text-red-500',
  cancelled: 'bg-zinc-500/10 text-zinc-400',
}

export function SessionsPanel({ boardId, taskId }: SessionsPanelProps) {
  const { t } = useTranslation()
  const { sessions, loading, fetchSessions, updateSession } = useAgentStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const taskSessions = sessions.filter((s) => s.task_id === taskId)

  const hasRunning = taskSessions.some((s) => s.status === 'running')

  useEffect(() => {
    fetchSessions(boardId, taskId)
  }, [boardId, taskId, fetchSessions])

  // Poll every 3s while sessions are running
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => fetchSessions(boardId, taskId), 3000)
    return () => clearInterval(id)
  }, [hasRunning, boardId, taskId, fetchSessions])

  const handleCancel = async (session: AgentSession) => {
    try {
      await agentApi.cancelSession(session.id)
      updateSession(session.id, { status: 'cancelled' })
    } catch {
      // fallback: cancel on server
      await api.cancelAgentSession(boardId, session.id)
      updateSession(session.id, { status: 'cancelled' })
    }
  }

  const toggleExpand = (sessionId: string) => {
    setExpandedId((prev) => (prev === sessionId ? null : sessionId))
  }

  if (loading && taskSessions.length === 0) {
    return <div className="text-sm text-muted-foreground py-2">{t('common.loading')}</div>
  }

  if (taskSessions.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <Terminal className="size-3.5" />
        {t('agent.sessions')}
      </h4>
      {taskSessions.map((session) => (
        <div key={session.id} className="rounded-md border text-sm">
          <div className="flex items-center gap-2 px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => toggleExpand(session.id)}
            >
              {expandedId === session.id ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </Button>

            <Badge variant="outline" className={statusColors[session.status]}>
              {session.status}
            </Badge>

            {session.branch_name && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranch className="size-3" />
                {session.branch_name}
              </span>
            )}

            <span className="text-xs text-muted-foreground ml-auto">
              {session.started_at &&
                formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
            </span>

            {session.status === 'running' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-red-500 hover:text-red-600"
                onClick={() => handleCancel(session)}
              >
                <Square className="size-3.5" />
              </Button>
            )}
          </div>

          {expandedId === session.id && (
            <SessionLog session={session} />
          )}
        </div>
      ))}
    </div>
  )
}

function SessionLog({ session }: { session: AgentSession }) {
  const { t } = useTranslation()
  if (session.status === 'running') {
    return (
      <div className="border-t px-3 py-3 text-xs text-muted-foreground">
        {t('agent.runningInTerminal')}
      </div>
    )
  }

  if (!session.log) {
    return (
      <div className="border-t px-3 py-3 text-xs text-muted-foreground italic">
        {t('agent.noLog')}
      </div>
    )
  }

  return (
    <div className="border-t">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-3 py-2 text-xs text-zinc-300 font-mono">
        {session.log}
      </pre>
    </div>
  )
}
