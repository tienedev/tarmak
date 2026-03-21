const AGENT_DEFAULT_URL = 'http://localhost:9876'

let agentToken: string | null = localStorage.getItem('agent-token')

export const agentApi = {
  setToken(token: string) {
    agentToken = token
    localStorage.setItem('agent-token', token)
  },

  getToken(): string | null {
    return agentToken
  },

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (agentToken) {
      headers['Authorization'] = `Bearer ${agentToken}`
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
    return this.request('/health')
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
    const token = agentToken ? `?token=${encodeURIComponent(agentToken)}` : ''
    return `ws://localhost:9876/ws/${sessionId}${token}`
  },
}
