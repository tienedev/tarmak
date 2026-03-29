export type AgentSessionStatus = "running" | "success" | "failed" | "cancelled";

export interface AgentSession {
  id: string;
  board_id: string;
  task_id: string;
  user_id: string;
  status: AgentSessionStatus;
  branch_name: string | null;
  agent_profile_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  exit_code: number | null;
  log: string | null;
}
