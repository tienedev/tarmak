import { createDb, migrateDb } from "@tarmak/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Context } from "../../trpc/context";
import { appRouter } from "../../trpc/router";

function createTestContext(): Context {
  const db = createDb();
  migrateDb(db);
  return { db, user: { id: "u1", name: "Test User", email: "test@test.com" } };
}

function seedUser(ctx: Context) {
  ctx.db.run(
    sql`INSERT INTO users (id, name, email) VALUES (${ctx.user!.id}, ${ctx.user!.name}, ${ctx.user!.email})`,
  );
}

async function seedBoardColumnTask(ctx: Context) {
  seedUser(ctx);
  const caller = appRouter.createCaller(ctx);
  const board = await caller.board.create({ name: "Test Board" });
  const column = await caller.column.create({ boardId: board.id, name: "Todo" });
  const task = await caller.task.create({
    boardId: board.id,
    columnId: column.id,
    title: "Test Task",
  });
  return { board, column, task };
}

describe("agent procedures", () => {
  describe("create", () => {
    it("creates an agent session", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });
      expect(session.id).toBeDefined();
      expect(session.board_id).toBe(board.id);
      expect(session.task_id).toBe(task.id);
      expect(session.user_id).toBe("u1");
      expect(session.status).toBe("running");
    });

    it("creates a session with branch name", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
        branchName: "feat/task-123",
      });
      expect(session.branch_name).toBe("feat/task-123");
    });

    it("creates a session with agent profile id", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
        agentProfileId: "profile-1",
      });
      expect(session.agent_profile_id).toBe("profile-1");
    });
  });

  describe("get", () => {
    it("returns a session by id", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });
      const fetched = await caller.agent.get({ boardId: board.id, id: session.id });
      expect(fetched.id).toBe(session.id);
    });

    it("throws FORBIDDEN for non-member board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.agent.get({ boardId: "nonexistent", id: "nonexistent" })).rejects.toThrow(
        "Not a board member",
      );
    });
  });

  describe("update", () => {
    it("updates session status", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });

      const updated = await caller.agent.update({
        id: session.id,
        status: "success",
        exitCode: 0,
      });
      expect(updated.status).toBe("success");
      expect(updated.exit_code).toBe(0);
      expect(updated.finished_at).toBeDefined();
    });

    it("updates session branch name", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });

      const updated = await caller.agent.update({
        id: session.id,
        branchName: "feat/new-branch",
      });
      expect(updated.branch_name).toBe("feat/new-branch");
    });

    it("updates session log", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });

      const updated = await caller.agent.update({
        id: session.id,
        log: "Build completed successfully",
      });
      expect(updated.log).toBe("Build completed successfully");
    });

    it("throws NOT_FOUND for non-existent session", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.agent.update({ id: "nonexistent", status: "failed" })).rejects.toThrow(
        "NOT_FOUND",
      );
    });
  });

  describe("list", () => {
    it("lists all sessions for a board", async () => {
      const ctx = createTestContext();
      const { board, task, column } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.agent.create({ boardId: board.id, taskId: task.id });

      const task2 = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 2",
      });
      await caller.agent.create({ boardId: board.id, taskId: task2.id });

      const sessions = await caller.agent.list({ boardId: board.id });
      expect(sessions).toHaveLength(2);
    });

    it("filters sessions by status", async () => {
      const ctx = createTestContext();
      const { board, task, column } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const s1 = await caller.agent.create({ boardId: board.id, taskId: task.id });
      await caller.agent.update({ id: s1.id, status: "success" });

      const task2 = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 2",
      });
      await caller.agent.create({ boardId: board.id, taskId: task2.id });

      const running = await caller.agent.list({ boardId: board.id, status: "running" });
      expect(running).toHaveLength(1);

      const success = await caller.agent.list({ boardId: board.id, status: "success" });
      expect(success).toHaveLength(1);
    });

    it("returns empty list for board with no sessions", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const sessions = await caller.agent.list({ boardId: board.id });
      expect(sessions).toHaveLength(0);
    });
  });

  describe("getRunning", () => {
    it("returns running session for a task", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });

      const running = await caller.agent.getRunning({ taskId: task.id });
      expect(running).not.toBeNull();
      expect(running?.id).toBe(session.id);
    });

    it("returns null when no running session", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const session = await caller.agent.create({
        boardId: board.id,
        taskId: task.id,
      });
      await caller.agent.update({ id: session.id, status: "success" });

      const running = await caller.agent.getRunning({ taskId: task.id });
      expect(running).toBeNull();
    });
  });
});
