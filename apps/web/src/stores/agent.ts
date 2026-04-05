import { create } from 'zustand'
import { trpcClient } from '@/lib/trpc'
import type { AgentSession } from '@/lib/types'

export interface StreamMessage {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'plan' | 'result' | 'status' | 'error'
  content?: string
  tool?: string
  input?: Record<string, unknown>
  output?: string
  message?: string
  status?: string
}

interface AgentStore {
  sessions: AgentSession[]
  loading: boolean
  streamMessages: Map<string, StreamMessage[]>
  streamStatuses: Map<string, string>
  fetchSessions: (boardId: string, taskId?: string) => Promise<void>
  addSession: (session: AgentSession) => void
  updateSession: (sessionId: string, data: Partial<AgentSession>) => void
  appendStreamMessage: (sessionId: string, message: StreamMessage) => void
  setStreamStatus: (sessionId: string, status: string) => void
  clearStream: (sessionId: string) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  sessions: [],
  loading: false,
  streamMessages: new Map(),
  streamStatuses: new Map(),

  fetchSessions: async (boardId, taskId) => {
    set({ loading: true })
    try {
      const sessions = await trpcClient.agent.list.query({
        boardId,
      }) as AgentSession[]
      // If taskId was given, filter client-side (the tRPC procedure filters by boardId + optional status)
      const filtered = taskId ? sessions.filter((s) => s.task_id === taskId) : sessions
      set({ sessions: filtered, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addSession: (session) => {
    set((state) => ({ sessions: [session, ...state.sessions] }))
  },

  updateSession: (sessionId, data) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...data } : s
      ),
    }))
  },

  appendStreamMessage: (sessionId, message) => {
    set((state) => {
      const map = new Map(state.streamMessages)
      const existing = map.get(sessionId) ?? []
      map.set(sessionId, [...existing, message])
      return { streamMessages: map }
    })
  },

  setStreamStatus: (sessionId, status) => {
    set((state) => {
      const map = new Map(state.streamStatuses)
      map.set(sessionId, status)
      return { streamStatuses: map }
    })
  },

  clearStream: (sessionId) => {
    set((state) => {
      const msgs = new Map(state.streamMessages)
      const stats = new Map(state.streamStatuses)
      msgs.delete(sessionId)
      stats.delete(sessionId)
      return { streamMessages: msgs, streamStatuses: stats }
    })
  },
}))
