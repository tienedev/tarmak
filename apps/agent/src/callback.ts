// agent/src/callback.ts
import type { Session } from "./types.js";

/**
 * Report a new agent session to the Tarmak API via tRPC.
 * Uses the `agent.create` mutation at POST /trpc/agent.create.
 */
export async function reportSessionCreated(
  serverUrl: string,
  serverToken: string,
  session: Session
): Promise<void> {
  try {
    await fetch(`${serverUrl}/trpc/agent.create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverToken}`,
      },
      body: JSON.stringify({
        json: {
          boardId: session.boardId,
          taskId: session.taskId,
          branchName: session.branchName,
        },
      }),
    });
  } catch {
    // fire-and-forget — matching Rust behavior
  }
}

/**
 * Report session completion to the Tarmak API via tRPC.
 * Uses the `agent.update` mutation at POST /trpc/agent.update.
 */
export async function reportSessionCompleted(
  serverUrl: string,
  serverToken: string,
  session: Session
): Promise<void> {
  const status =
    session.status === "cancelled"
      ? "cancelled"
      : session.exitCode === 0
        ? "success"
        : "failed";

  try {
    await fetch(`${serverUrl}/trpc/agent.update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverToken}`,
      },
      body: JSON.stringify({
        json: {
          id: session.id,
          status,
          exitCode: session.exitCode ?? undefined,
          log: session.log || undefined,
        },
      }),
    });
  } catch {
    // best-effort
  }
}
