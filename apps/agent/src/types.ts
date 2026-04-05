// agent/src/types.ts

// --- WebSocket Protocol: Server → Client ---

export type ServerMessage =
  | { type: "assistant"; content: string }
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "plan"; content: string }
  | { type: "result"; content: string }
  | { type: "status"; status: SessionStreamStatus }
  | { type: "error"; message: string };

export type SessionStreamStatus =
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "success"
  | "failed"
  | "cancelled";

// --- WebSocket Protocol: Client → Server ---

export type ClientMessage = { type: "approve" } | { type: "reject" };

// --- Session ---

export interface Session {
  id: string;
  boardId: string;
  taskId: string;
  branchName: string;
  worktreePath: string;
  prompt: string;
  status: SessionStreamStatus | "running";
  log: string;
  exitCode: number | null;
  messages: ServerMessage[];
}

// --- API types (compatible with existing frontend) ---

export interface RunRequest {
  board_id: string;
  task_id: string;
  prompt: string;
  repo_url: string;
}

export interface RunResponse {
  session_id: string;
  status: string;
  branch_name: string;
  ws_url: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  protocol_version: number;
  sessions_active: number;
}

export interface SessionInfo {
  session_id: string;
  board_id: string;
  task_id: string;
  status: string;
}
