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
  // Boards
  listBoards: () => request<Board[]>('/boards'),
  createBoard: (data: { name: string; description?: string }) =>
    request<Board>('/boards', { method: 'POST', body: JSON.stringify(data) }),
  getBoard: (id: string) => request<Board>(`/boards/${id}`),
  deleteBoard: (id: string) =>
    request<void>(`/boards/${id}`, { method: 'DELETE' }),

  // Columns
  listColumns: (boardId: string) =>
    request<Column[]>(`/boards/${boardId}/columns`),
  createColumn: (boardId: string, data: { name: string; color?: string }) =>
    request<Column>(`/boards/${boardId}/columns`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Tasks
  listTasks: (boardId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    const query = qs.toString()
    return request<Task[]>(`/boards/${boardId}/tasks${query ? `?${query}` : ''}`)
  },
  createTask: (
    boardId: string,
    data: { column_id: string; title: string; priority?: string },
  ) =>
    request<Task>(`/boards/${boardId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTask: (
    boardId: string,
    taskId: string,
    data: Partial<Omit<Task, 'id' | 'board_id' | 'created_at' | 'updated_at'>>,
  ) =>
    request<Task>(`/boards/${boardId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  moveTask: (
    boardId: string,
    taskId: string,
    data: { column_id: string; position: number },
  ) =>
    request<Task>(`/boards/${boardId}/tasks/${taskId}/move`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTask: (boardId: string, taskId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}`, { method: 'DELETE' }),

  // Custom Fields
  listFields: (boardId: string) =>
    request<CustomField[]>(`/boards/${boardId}/fields`),
  createField: (
    boardId: string,
    data: { name: string; field_type: string },
  ) =>
    request<CustomField>(`/boards/${boardId}/fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Field Values
  getFieldValues: (boardId: string, taskId: string) =>
    request<FieldValue[]>(`/boards/${boardId}/tasks/${taskId}/fields`),
  setFieldValue: (boardId: string, taskId: string, fieldId: string, value: string) =>
    request<FieldValue>(`/boards/${boardId}/tasks/${taskId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  // Comments
  listComments: (boardId: string, taskId: string) =>
    request<Comment[]>(`/boards/${boardId}/tasks/${taskId}/comments`),
  createComment: (
    boardId: string,
    taskId: string,
    data: { content: string },
  ) =>
    request<Comment>(`/boards/${boardId}/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateComment: (
    boardId: string,
    taskId: string,
    commentId: string,
    data: { content: string },
  ) =>
    request<Comment>(`/boards/${boardId}/tasks/${taskId}/comments/${commentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteComment: (boardId: string, taskId: string, commentId: string) =>
    request<{ deleted: boolean }>(
      `/boards/${boardId}/tasks/${taskId}/comments/${commentId}`,
      { method: 'DELETE' },
    ),

  // Auth
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

  // API Keys
  listApiKeys: () => request<ApiKey[]>('/api-keys'),
  createApiKey: (data: { name: string }) =>
    request<{ key: string; api_key: ApiKey }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteApiKey: (id: string) =>
    request<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  // Board Members
  listMembers: (boardId: string) =>
    request<BoardMember[]>(`/boards/${boardId}/members`),

  // Invitations
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

  // Activity
  listActivity: (
    boardId: string,
    params?: { limit?: number; offset?: number; action?: string; user_id?: string },
  ) => {
    const qs = new URLSearchParams()
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    if (params?.action) qs.set('action', params.action)
    if (params?.user_id) qs.set('user_id', params.user_id)
    const query = qs.toString()
    return request<ActivityEntry[]>(`/boards/${boardId}/activity${query ? `?${query}` : ''}`)
  },

  // Labels
  listLabels: (boardId: string) =>
    request<Label[]>(`/boards/${boardId}/labels`),
  createLabel: (boardId: string, data: { name: string; color: string }) =>
    request<Label>(`/boards/${boardId}/labels`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLabel: (boardId: string, labelId: string, data: { name?: string; color?: string }) =>
    request<Label>(`/boards/${boardId}/labels/${labelId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteLabel: (boardId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/labels/${labelId}`, { method: 'DELETE' }),
  addTaskLabel: (boardId: string, taskId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_id: labelId }),
    }),
  removeTaskLabel: (boardId: string, taskId: string, labelId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/labels/${labelId}`, {
      method: 'DELETE',
    }),

  // Search
  searchBoard: (boardId: string, q: string, limit = 20, includeArchived = false) =>
    request<SearchResult[]>(
      `/boards/${boardId}/search?q=${encodeURIComponent(q)}&limit=${limit}${includeArchived ? '&include_archived=true' : ''}`,
    ),

  // Subtasks
  listSubtasks: (boardId: string, taskId: string) =>
    request<Subtask[]>(`/boards/${boardId}/tasks/${taskId}/subtasks`),
  createSubtask: (boardId: string, taskId: string, data: { title: string }) =>
    request<Subtask>(`/boards/${boardId}/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSubtask: (
    boardId: string,
    taskId: string,
    subtaskId: string,
    data: { title?: string; completed?: boolean; position?: number },
  ) =>
    request<Subtask>(`/boards/${boardId}/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSubtask: (boardId: string, taskId: string, subtaskId: string) =>
    request<void>(`/boards/${boardId}/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: 'DELETE',
    }),

  // Archive
  archiveTask: (boardId: string, taskId: string) =>
    request<{ archived: boolean }>(`/boards/${boardId}/tasks/${taskId}/archive`, { method: 'POST' }),
  unarchiveTask: (boardId: string, taskId: string) =>
    request<{ unarchived: boolean }>(`/boards/${boardId}/tasks/${taskId}/unarchive`, { method: 'POST' }),
  archiveColumn: (boardId: string, columnId: string) =>
    request<{ archived: boolean; task_count: number }>(`/boards/${boardId}/columns/${columnId}/archive`, {
      method: 'POST',
    }),
  unarchiveColumn: (boardId: string, columnId: string) =>
    request<{ unarchived: boolean; task_count: number }>(`/boards/${boardId}/columns/${columnId}/unarchive`, {
      method: 'POST',
    }),
  listArchived: (boardId: string) =>
    request<{ tasks: Task[]; columns: Column[] }>(`/boards/${boardId}/archive`),

  // Attachments
  listAttachments: (boardId: string, taskId: string) =>
    request<Attachment[]>(`/boards/${boardId}/tasks/${taskId}/attachments`),
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
  deleteAttachment: (boardId: string, taskId: string, attachmentId: string) =>
    request<{ deleted: boolean }>(`/boards/${boardId}/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    }),

  // Column management
  updateColumn: (
    boardId: string,
    columnId: string,
    data: { name?: string; wip_limit?: number | null; color?: string | null },
  ) =>
    request<{ updated: boolean }>(`/boards/${boardId}/columns/${columnId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteColumn: (boardId: string, columnId: string) =>
    request<{ deleted: boolean }>(`/boards/${boardId}/columns/${columnId}`, {
      method: 'DELETE',
    }),
  moveColumn: (boardId: string, columnId: string, position: number) =>
    request<{ moved: boolean }>(`/boards/${boardId}/columns/${columnId}/move`, {
      method: 'POST',
      body: JSON.stringify({ position }),
    }),
}

// Types
export interface Board {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Column {
  id: string
  board_id: string
  name: string
  position: number
  wip_limit?: number
  color?: string
  archived?: boolean
}

export interface Task {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string
  priority: string
  assignee?: string
  due_date?: string | null
  labels?: Label[]
  subtask_count?: SubtaskCount
  position: number
  created_at: string
  updated_at: string
  archived?: boolean
  attachment_count?: number
}

export interface Label {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  completed: boolean
  position: number
  created_at: string
}

export interface SubtaskCount {
  completed: number
  total: number
}

export interface CustomField {
  id: string
  board_id: string
  name: string
  field_type: string
  config: unknown
  position: number
}

export interface FieldValue {
  task_id: string
  field_id: string
  value: string
}

export interface Comment {
  id: string
  task_id: string
  user_id: string
  user_name?: string
  content: string
  created_at: string
  updated_at: string | null
}

export interface AuthResponse {
  token: string
  user: { id: string; name: string; email: string }
}

export interface ApiKey {
  id: string
  user_id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at?: string
}

export interface BoardMember {
  id: string
  name: string
  email: string
  avatar_url?: string
  role: string
}

export interface InviteLink {
  id: string
  board_id: string
  role: string
  token: string
  expires_at: string
  created_by: string
}

export interface ActivityEntry {
  id: string
  board_id: string
  task_id?: string
  user_id: string
  user_name: string
  is_agent: boolean
  action: string
  details?: string
  created_at: string
}

export interface SearchResult {
  entity_type: string
  entity_id: string
  board_id: string
  task_id: string
  snippet: string
  rank: number
  archived?: boolean
}

export interface Attachment {
  id: string
  task_id: string
  board_id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  uploaded_by?: string
  created_at: string
}
