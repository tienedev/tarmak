import { useEffect, useState } from 'react'
import { agentApi } from '@/lib/agent'

export type AgentStatus = 'connected' | 'disconnected' | 'checking'

export function useAgentStatus(pollInterval = 30000): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>('checking')

  useEffect(() => {
    let mounted = true

    const check = async () => {
      try {
        await agentApi.health()
        if (mounted) setStatus('connected')
      } catch {
        if (mounted) setStatus('disconnected')
      }
    }

    check()
    const interval = setInterval(check, pollInterval)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [pollInterval])

  return status
}
