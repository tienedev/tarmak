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
    sql`INSERT INTO users (id, name, email) VALUES (${ctx.user?.id}, ${ctx.user?.name}, ${ctx.user?.email})`,
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

describe("archive procedures", () => {
  describe("archiveTask", () => {
    it("archives a task", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.archive.archiveTask({ boardId: board.id, taskId: task.id });
      expect(result.success).toBe(true);

      const archived = await caller.archive.listArchivedTasks({ boardId: board.id });
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(task.id);
    });

    it("throws NOT_FOUND for non-existent task", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.archive.archiveTask({ boardId: board.id, taskId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("unarchiveTask", () => {
    it("unarchives a task", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.archive.archiveTask({ boardId: board.id, taskId: task.id });

      const result = await caller.archive.unarchiveTask({ boardId: board.id, taskId: task.id });
      expect(result.success).toBe(true);

      const archived = await caller.archive.listArchivedTasks({ boardId: board.id });
      expect(archived).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent task", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.archive.unarchiveTask({ boardId: board.id, taskId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("listArchivedTasks", () => {
    it("returns empty list when no archived tasks", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const archived = await caller.archive.listArchivedTasks({ boardId: board.id });
      expect(archived).toHaveLength(0);
    });

    it("returns only archived tasks for a board", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const task2 = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 2",
      });

      // Archive only the second task
      await caller.archive.archiveTask({ boardId: board.id, taskId: task2.id });

      const archived = await caller.archive.listArchivedTasks({ boardId: board.id });
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(task2.id);
    });
  });

  describe("listArchivedColumns", () => {
    it("returns empty list when no archived columns", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const archived = await caller.archive.listArchivedColumns({ boardId: board.id });
      expect(archived).toHaveLength(0);
    });

    it("returns archived columns for a board", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      // Archive a column directly in the DB (there's no archiveColumn procedure yet)
      ctx.db.run(sql`UPDATE columns SET archived = 1 WHERE board_id = ${board.id}`);

      const archived = await caller.archive.listArchivedColumns({ boardId: board.id });
      expect(archived).toHaveLength(1);
    });
  });
});
