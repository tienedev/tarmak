import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createAgentSession,
  getAgentSession,
  updateAgentSession,
  listBoardSessions,
  getRunningSession,
} from "../../repo/agent";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createTask } from "../../repo/tasks";
import { users } from "../../schema/users";
import type { DB } from "../../connection";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedBoardColumnTask(db: DB) {
  db.insert(users)
    .values({ id: "agent-user", name: "Agent", email: "agent@test.com", is_agent: true })
    .run();
  const board = createBoard(db, "Board");
  const col = createColumn(db, board.id, "Todo");
  const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });
  return { board, col, task };
}

describe("agent repo", () => {
  describe("createAgentSession", () => {
    it("creates a session with running status", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      expect(session.id).toBeDefined();
      expect(session.board_id).toBe(board.id);
      expect(session.task_id).toBe(task.id);
      expect(session.user_id).toBe("agent-user");
      expect(session.status).toBe("running");
      expect(session.started_at).toBeDefined();
      expect(session.finished_at).toBeNull();
      expect(session.branch_name).toBeNull();
      expect(session.agent_profile_id).toBeNull();
      expect(session.exit_code).toBeNull();
      expect(session.log).toBeNull();
      expect(session.created_at).toBeDefined();
    });

    it("creates a session with optional fields", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
        branchName: "feat/task-123",
        agentProfileId: "profile-1",
      });

      expect(session.branch_name).toBe("feat/task-123");
      expect(session.agent_profile_id).toBe("profile-1");
    });
  });

  describe("getAgentSession", () => {
    it("retrieves an existing session", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const found = getAgentSession(db, session.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(session.id);
    });

    it("returns null for non-existent session", () => {
      const db = setup();
      expect(getAgentSession(db, "nonexistent")).toBeNull();
    });
  });

  describe("updateAgentSession", () => {
    it("updates status to success and sets finished_at", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const updated = updateAgentSession(db, session.id, { status: "success", exitCode: 0 });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("success");
      expect(updated!.exit_code).toBe(0);
      expect(updated!.finished_at).toBeDefined();
      expect(updated!.finished_at).not.toBeNull();
    });

    it("updates status to failed and sets finished_at", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const updated = updateAgentSession(db, session.id, {
        status: "failed",
        exitCode: 1,
        log: "Error occurred",
      });
      expect(updated!.status).toBe("failed");
      expect(updated!.exit_code).toBe(1);
      expect(updated!.log).toBe("Error occurred");
      expect(updated!.finished_at).not.toBeNull();
    });

    it("updates status to cancelled and sets finished_at", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const updated = updateAgentSession(db, session.id, { status: "cancelled" });
      expect(updated!.status).toBe("cancelled");
      expect(updated!.finished_at).not.toBeNull();
    });

    it("updates branch name without setting finished_at", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const updated = updateAgentSession(db, session.id, { branchName: "feat/new-branch" });
      expect(updated!.branch_name).toBe("feat/new-branch");
      expect(updated!.finished_at).toBeNull();
      expect(updated!.status).toBe("running");
    });

    it("returns null for non-existent session", () => {
      const db = setup();
      expect(updateAgentSession(db, "nonexistent", { status: "success" })).toBeNull();
    });
  });

  describe("listBoardSessions", () => {
    it("returns all sessions for a board", () => {
      const db = setup();
      const { board, col, task } = seedBoardColumnTask(db);
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      createAgentSession(db, { boardId: board.id, taskId: task.id, userId: "agent-user" });
      createAgentSession(db, { boardId: board.id, taskId: task2.id, userId: "agent-user" });

      const sessions = listBoardSessions(db, board.id);
      expect(sessions).toHaveLength(2);
    });

    it("filters by status", () => {
      const db = setup();
      const { board, col, task } = seedBoardColumnTask(db);
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      const s1 = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });
      createAgentSession(db, { boardId: board.id, taskId: task2.id, userId: "agent-user" });

      updateAgentSession(db, s1.id, { status: "success" });

      const running = listBoardSessions(db, board.id, "running");
      expect(running).toHaveLength(1);

      const succeeded = listBoardSessions(db, board.id, "success");
      expect(succeeded).toHaveLength(1);
    });

    it("returns all sessions for the board", () => {
      const db = setup();
      const { board, col, task } = seedBoardColumnTask(db);
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      const s1 = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });
      const s2 = createAgentSession(db, {
        boardId: board.id,
        taskId: task2.id,
        userId: "agent-user",
      });

      const sessions = listBoardSessions(db, board.id);
      expect(sessions).toHaveLength(2);
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual([s1.id, s2.id].sort());
    });
  });

  describe("getRunningSession", () => {
    it("returns running session for a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });

      const running = getRunningSession(db, task.id);
      expect(running).not.toBeNull();
      expect(running!.id).toBe(session.id);
      expect(running!.status).toBe("running");
    });

    it("returns null when no running session", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const session = createAgentSession(db, {
        boardId: board.id,
        taskId: task.id,
        userId: "agent-user",
      });
      updateAgentSession(db, session.id, { status: "success" });

      expect(getRunningSession(db, task.id)).toBeNull();
    });

    it("returns null for a task with no sessions", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(getRunningSession(db, task.id)).toBeNull();
    });
  });
});
