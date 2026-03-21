import { create } from 'zustand'
import { api } from '@/lib/api'
import type { AgentSession } from '@/lib/api'

interface AgentStore {
  sessions: AgentSession[]
  loading: boolean
  fetchSessions: (boardId: string, taskId?: string) => Promise<void>
  addSession: (session: AgentSession) => void
  updateSession: (sessionId: string, data: Partial<AgentSession>) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  sessions: [],
  loading: false,

  fetchSessions: async (boardId, taskId) => {
    set({ loading: true })
    try {
      const sessions = await api.listAgentSessions(boardId, taskId)
      set({ sessions, loading: false })
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
}))
