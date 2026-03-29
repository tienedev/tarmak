import type { Label } from "./label";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Board {
  id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  color: string | null;
  archived: boolean;
}

export interface Task {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: string | null;
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  archived: boolean;
  locked_by: string | null;
  locked_at: string | null;
}

export interface TaskWithRelations extends Task {
  labels: Label[];
  subtask_count: SubtaskCount;
  attachment_count: number;
}

export interface SubtaskCount {
  completed: number;
  total: number;
}

export interface Activity {
  id: string;
  board_id: string;
  task_id: string;
  user_id: string;
  action: string;
  details: string | null;
  created_at: string;
}

export interface ActivityEntry extends Activity {
  user_name: string;
  is_agent: boolean;
}

export interface SearchResult {
  entity_type: string;
  entity_id: string;
  board_id: string;
  task_id: string;
  snippet: string;
  rank: number;
  archived: boolean;
}
