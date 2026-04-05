/**
 * Slim REST client — only for endpoints that tRPC doesn't cover:
 *   - Better Auth (login, register, me)
 *   - File upload (multipart)
 *   - Invite links (Better Auth HTTP API)
 *   - API keys (REST-only)
 *   - Notification SSE stream ticket
 *
 * All board/task/column CRUD is now via tRPC — see `@/lib/trpc`.
 */

import type { Attachment, AuthResponse, ApiKey, InviteLink } from './types'

const BASE = '/api/v1'

// Callbacks for auth events — wired by the auth store at init time.
let onUnauthorized: (() => void) | null = null

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    // On 401, clear token and redirect to login — session expired or invalid.
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized()
    }
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  // Auth (Better Auth HTTP API — not tRPC)
  register: (data: { name: string; email: string; password: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => request<{ id: string; name: string; email: string }>('/auth/me'),

  // API Keys (REST-only)
  listApiKeys: () => request<ApiKey[]>('/api-keys'),
  createApiKey: (data: { name: string }) =>
    request<{ key: string; api_key: ApiKey }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteApiKey: (id: string) =>
    request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  // Invitations (Better Auth HTTP API — not tRPC)
  createInvite: (data: { board_id: string; role: string }) =>
    request<{ invite_url: string }>('/auth/invite', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listInvites: (boardId: string) =>
    request<InviteLink[]>(`/auth/invite?board_id=${boardId}`),
  revokeInvite: (inviteId: string) =>
    request<void>(`/auth/invite/${inviteId}`, { method: 'DELETE' }),
  acceptInvite: (data: { invite_token: string }) =>
    request<{ ok: boolean }>('/auth/accept', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // File upload (multipart — tRPC doesn't handle this)
  uploadAttachment: async (boardId: string, taskId: string, file: File): Promise<Attachment> => {
    const token = localStorage.getItem('token')
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/boards/${boardId}/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    return res.json()
  },
}

// Re-export types for backward compatibility (components can import from either place)
export type {
  Board,
  Column,
  Task,
  Label,
  Subtask,
  SubtaskCount,
  CustomField,
  FieldValue,
  Comment,
  ServerNotification,
  AuthResponse,
  ApiKey,
  BoardMember,
  InviteLink,
  ActivityEntry,
  SearchResult,
  Attachment,
  AgentSession,
} from './types'
