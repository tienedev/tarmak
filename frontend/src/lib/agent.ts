import { useAuthStore } from '@/stores/auth'

export class AgentApiError extends Error {
  status: number
  hint?: string
  constructor(status: number, message: string, hint?: string) {
    super(message)
    this.name = 'AgentApiError'
    this.status = status
    this.hint = hint
  }
}

export interface McpServer {
  name: string
  scope: 'global' | 'user' | 'project' | 'local'
  command: string | null
  args: string[] | null
}

export interface SkillInfo {
  name: string
  description: string
  dir: string
  plugin: string
  enabled: boolean
}

export interface HookEntry {
  command: string
  [key: string]: unknown
}

export type HooksConfig = Record<string, HookEntry[]>

export interface ProjectConfig {
  repo_url: string
  workdir: string
  claude_md: string | null
  settings: Record<string, unknown> | null
  mcp_servers: McpServer[]
  skills: SkillInfo[]
}

export interface AgentConfig {
  global: {
    settings: Record<string, unknown> | null
    mcp_servers: Record<string, unknown> | null
  }
  plugins: Record<string, unknown[]> | null
  skills: SkillInfo[]
  hooks: HooksConfig | null
  projects: ProjectConfig[]
  stats: {
    totalSessions: number | null
    totalMessages: number | null
    modelUsage: Record<string, unknown> | null
  } | null
}

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
      throw new AgentApiError(res.status, body.message || res.statusText, body.hint)
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

  getConfig(): Promise<AgentConfig> {
    return this.request('/config')
  },

  getWsUrl(sessionId: string): string {
    const token = getToken()
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    return `ws://localhost:9876/ws/${sessionId}${query}`
  },
}
