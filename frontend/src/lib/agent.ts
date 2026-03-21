import { useAuthStore } from '@/stores/auth'

const AGENT_DEFAULT_URL = 'http://localhost:9876'

function getToken(): string | null {
  return useAuthStore.getState().token
}

export const agentApi = {
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const token = getToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const res = await fetch(`${AGENT_DEFAULT_URL}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw { status: res.status, ...body }
    }
    return res.json()
  },

  health(): Promise<{ status: string; version: string; protocol_version: number; sessions_active: number }> {
    // Health is unauthenticated — no token needed
    return fetch(`${AGENT_DEFAULT_URL}/health`).then((r) => {
      if (!r.ok) throw new Error('Agent not reachable')
      return r.json()
    })
  },

  run(data: { board_id: string; task_id: string; prompt: string; repo_url: string }): Promise<{
    session_id: string
    status: string
    branch_name: string
    ws_url: string
  }> {
    return this.request('/run', { method: 'POST', body: JSON.stringify(data) })
  },

  listSessions(): Promise<Array<{ session_id: string; board_id: string; task_id: string; status: string }>> {
    return this.request('/sessions')
  },

  cancelSession(sessionId: string): Promise<{ status: string }> {
    return this.request(`/sessions/${sessionId}/cancel`, { method: 'POST' })
  },

  setWorkdir(repoUrl: string, workdir: string): Promise<{ status: string }> {
    return this.request('/config/set-workdir', {
      method: 'POST',
      body: JSON.stringify({ repo_url: repoUrl, workdir }),
    })
  },

  getWsUrl(sessionId: string): string {
    const token = getToken()
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    return `ws://localhost:9876/ws/${sessionId}${query}`
  },
}
