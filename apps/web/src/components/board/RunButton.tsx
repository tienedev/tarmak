import { Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { AgentStatus } from '@/hooks/useAgentStatus'
import { agentApi } from '@/lib/agent'
import { trpcClient } from '@/lib/trpc'
import type { Task, Subtask } from '@/lib/types'
import { useAgentStore } from '@/stores/agent'
import { useBoardStore } from '@/stores/board'

interface RunButtonProps {
  task: Task
  boardId: string
  agentStatus: AgentStatus
  onSessionStarted?: (sessionId: string) => void
}

function buildPrompt(task: Task, subtasks: Subtask[], boardName: string): string {
  let prompt = ''

  // Description first — allows starting with /commands
  if (task.description) {
    prompt += task.description
  }

  // Subtasks
  if (subtasks.length > 0) {
    prompt += '\n\nSubtasks:'
    for (const st of subtasks) {
      prompt += `\n- [${st.completed ? 'x' : ' '}] ${st.title}`
    }
  }

  // Ticket & board metadata at the end
  prompt += `\n\nTicket: ${task.title}`
  prompt += `\nBoard: ${boardName}`

  return prompt.trim()
}

export function RunButton({ task, boardId, agentStatus, onSessionStarted }: RunButtonProps) {
  const { t } = useTranslation()
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<{ message: string; hint: string } | null>(null)
  const [showWarning, setShowWarning] = useState(false)
  const { currentBoard } = useBoardStore()
  const { addSession } = useAgentStore()

  const disabled = agentStatus !== 'connected' || launching || !currentBoard?.repo_url
  const acknowledged = localStorage.getItem('agent-autopilot-acknowledged') === 'true'

  const handleRunClick = () => {
    if (!acknowledged) {
      setShowWarning(true)
      return
    }
    handleRun()
  }

  const handleAcceptWarning = () => {
    localStorage.setItem('agent-autopilot-acknowledged', 'true')
    setShowWarning(false)
    handleRun()
  }

  const handleRun = async () => {
    if (!currentBoard?.repo_url) return
    setLaunching(true)
    setError(null)

    try {
      // Fetch subtasks for prompt construction
      const subtasks = await trpcClient.subtask.list.query({ boardId, taskId: task.id }) as Subtask[]
      const prompt = buildPrompt(task, subtasks, currentBoard.name)

      const result = await agentApi.run({
        board_id: boardId,
        task_id: task.id,
        prompt,
        repo_url: currentBoard.repo_url,
      })

      addSession({
        id: result.session_id,
        board_id: boardId,
        task_id: task.id,
        status: 'running',
        user_id: '',
        branch_name: result.branch_name,
        agent_profile_id: null,
        started_at: new Date().toISOString(),
        finished_at: null,
        exit_code: null,
        log: null,
        created_at: new Date().toISOString(),
      })

      onSessionStarted?.(result.session_id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to launch session'
      const hint = err instanceof Error && 'hint' in err ? (err as { hint?: string }).hint || '' : ''
      setError({ message, hint })
    } finally {
      setLaunching(false)
    }
  }

  const tooltip = agentStatus === 'disconnected'
    ? t('agent.agentDisabled')
    : !currentBoard?.repo_url
    ? t('agent.repoRequired')
    : undefined

  return (
    <div>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={handleRunClick}
        title={tooltip}
        className="gap-1.5"
      >
        <Play className="size-3.5" />
        {launching ? t('agent.launching') : t('agent.run')}
      </Button>
      {showWarning && (
        <div className="mt-2 p-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 text-sm">
          <p className="font-medium">{t('agent.autopilotTitle')}</p>
          <p className="text-muted-foreground text-xs mt-1">
            {t('agent.autopilotWarning')}
          </p>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => setShowWarning(false)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleAcceptWarning}>{t('agent.autopilotAccept')}</Button>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-500">
          <p>{error.message}</p>
          {error.hint && <p className="text-xs text-muted-foreground">{error.hint}</p>}
        </div>
      )}
    </div>
  )
}
