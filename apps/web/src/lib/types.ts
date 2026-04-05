/**
 * Shared frontend types.
 *
 * These match the shapes returned by the tRPC procedures and the REST API.
 * Components that previously imported types from `@/lib/api` should import
 * from here instead.
 */

export interface Board {
  id: string
  name: string
  description: string | null
  repo_url?: string | null
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

export interface ServerNotification {
  id: string
  user_id: string
  board_id: string
  task_id: string | null
  type: 'mention' | 'assignment' | 'deadline' | 'comment'
  title: string
  body: string | null
  read: boolean
  created_at: string
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

export type ViewMode = 'kanban' | 'list' | 'timeline' | 'sessions'

export interface AgentSession {
  id: string
  board_id: string
  task_id: string
  status: 'running' | 'planning' | 'awaiting_approval' | 'executing' | 'success' | 'failed' | 'cancelled'
  user_id: string
  branch_name: string | null
  agent_profile_id: string | null
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  log: string | null
  created_at: string
}
