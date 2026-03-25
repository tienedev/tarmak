import { useEffect, useRef, useCallback, useState } from 'react'
import { agentApi } from '@/lib/agent'
import { useAgentStore, type StreamMessage } from '@/stores/agent'

export type { StreamMessage }

export function useSessionStream(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const { streamMessages, streamStatuses, appendStreamMessage, setStreamStatus } = useAgentStore()

  const messages = sessionId ? streamMessages.get(sessionId) ?? [] : []
  const status = sessionId ? streamStatuses.get(sessionId) ?? 'running' : 'running'

  useEffect(() => {
    if (!sessionId) return

    const url = agentApi.getWsUrl(sessionId)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data)
        if (msg.type === 'status' && msg.status) {
          setStreamStatus(sessionId, msg.status)
        } else {
          appendStreamMessage(sessionId, msg)
        }
      } catch {
        // ignore malformed
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [sessionId, appendStreamMessage, setStreamStatus])

  const approve = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'approve' }))
  }, [])

  const reject = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'reject' }))
  }, [])

  return { messages, status, approve, reject, connected }
}
