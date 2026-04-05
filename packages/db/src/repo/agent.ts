import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../connection";
import { agentSessions } from "../schema/index";

export function createAgentSession(
  db: DB,
  opts: {
    boardId: string;
    taskId: string;
    userId: string;
    branchName?: string;
    agentProfileId?: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(agentSessions)
    .values({
      id,
      board_id: opts.boardId,
      task_id: opts.taskId,
      user_id: opts.userId,
      status: "running",
      branch_name: opts.branchName ?? null,
      agent_profile_id: opts.agentProfileId ?? null,
      started_at: now,
      created_at: now,
    })
    .run();

  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()!;
}

export function getAgentSession(db: DB, id: string) {
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get() ?? null;
}

export function updateAgentSession(
  db: DB,
  id: string,
  data: {
    status?: string;
    branchName?: string;
    exitCode?: number;
    log?: string;
  },
) {
  const existing = getAgentSession(db, id);
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (data.status !== undefined) updates.status = data.status;
  if (data.branchName !== undefined) updates.branch_name = data.branchName;
  if (data.exitCode !== undefined) updates.exit_code = data.exitCode;
  if (data.log !== undefined) updates.log = data.log;

  // Set finished_at when transitioning to a terminal status
  if (
    data.status !== undefined &&
    (data.status === "success" || data.status === "failed" || data.status === "cancelled")
  ) {
    updates.finished_at = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) return existing;

  db.update(agentSessions).set(updates).where(eq(agentSessions.id, id)).run();

  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()!;
}

export function listBoardSessions(db: DB, boardId: string, status?: string) {
  const conditions = [eq(agentSessions.board_id, boardId)];
  if (status !== undefined) {
    conditions.push(eq(agentSessions.status, status));
  }

  return db
    .select()
    .from(agentSessions)
    .where(and(...conditions))
    .orderBy(desc(agentSessions.created_at))
    .all();
}

export function getRunningSession(db: DB, taskId: string) {
  return (
    db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.task_id, taskId), eq(agentSessions.status, "running")))
      .get() ?? null
  );
}
