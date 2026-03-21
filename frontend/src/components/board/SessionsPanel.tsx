import { useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Eye, Square, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import type { AgentSession } from '@/lib/api'
import { agentApi } from '@/lib/agent'
import { useAgentStore } from '@/stores/agent'

interface SessionsPanelProps {
  boardId: string
  taskId: string
  onViewTerminal: (session: AgentSession) => void
}

const statusColors: Record<string, string> = {
  running: 'bg-green-500/10 text-green-500',
  success: 'bg-emerald-500/10 text-emerald-500',
  failed: 'bg-red-500/10 text-red-500',
  cancelled: 'bg-zinc-500/10 text-zinc-400',
}

export function SessionsPanel({ boardId, taskId, onViewTerminal }: SessionsPanelProps) {
  const { sessions, loading, fetchSessions, updateSession } = useAgentStore()
  const taskSessions = sessions.filter((s) => s.task_id === taskId)

  useEffect(() => {
    fetchSessions(boardId, taskId)
  }, [boardId, taskId, fetchSessions])

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

  if (loading && taskSessions.length === 0) {
    return <div className="text-sm text-muted-foreground py-2">Loading sessions...</div>
  }

  if (taskSessions.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">Agent Sessions</h4>
      {taskSessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        >
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
            {session.started_at && formatDistanceToNow(new Date(session.started_at), { addSuffix: true })}
          </span>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onViewTerminal(session)}
          >
            <Eye className="size-3.5" />
          </Button>

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
      ))}
    </div>
  )
}
