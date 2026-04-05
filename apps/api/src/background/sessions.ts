import type { DB } from "@tarmak/db";
import { agentSessions, sessions } from "@tarmak/db";
import { and, eq, lt } from "drizzle-orm";
import { logger } from "../logger";

export function startSessionCleanup(db: DB, intervalMs = 3_600_000): NodeJS.Timeout {
  return setInterval(() => {
    try {
      cleanupSessions(db);
    } catch (err) {
      logger.error({ err }, "Session cleanup failed");
    }
  }, intervalMs);
}

export function cleanupSessions(db: DB): void {
  const now = new Date().toISOString();

  // Delete expired auth sessions
  const authResult = db.delete(sessions).where(lt(sessions.expires_at, now)).run();

  if (authResult.changes > 0) {
    logger.info({ count: authResult.changes }, "Cleaned up expired auth sessions");
  }

  // Mark stale agent sessions (running for > 1 hour) as failed
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const agentResult = db
    .update(agentSessions)
    .set({ status: "failed", finished_at: now })
    .where(and(eq(agentSessions.status, "running"), lt(agentSessions.started_at, oneHourAgo)))
    .run();

  if (agentResult.changes > 0) {
    logger.info({ count: agentResult.changes }, "Marked stale agent sessions as failed");
  }
}
