// agent/src/callback.ts
import type { Session } from "./types.js";

export async function reportSessionCreated(
  serverUrl: string,
  serverToken: string,
  session: Session
): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/v1/boards/${session.boardId}/agent-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serverToken}`,
      },
      body: JSON.stringify({
        id: session.id,
        board_id: session.boardId,
        task_id: session.taskId,
        status: "running",
        branch_name: session.branchName,
      }),
    });
  } catch {
    // fire-and-forget — matching Rust behavior
  }
}

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
    await fetch(
      `${serverUrl}/api/v1/boards/${session.boardId}/agent-sessions/${session.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverToken}`,
        },
        body: JSON.stringify({
          status,
          exit_code: session.exitCode,
          log: session.log,
          finished_at: new Date().toISOString(),
        }),
      }
    );
  } catch {
    // best-effort
  }
}
