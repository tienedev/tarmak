import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, migrateDb } from "@tarmak/db";
import { appRouter } from "../../trpc/router";
import type { Context } from "../../trpc/context";

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

describe("subtask procedures", () => {
  describe("create", () => {
    it("creates a subtask for a task", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtask = await caller.subtask.create({
        taskId: task.id,
        title: "Subtask 1",
      });
      expect(subtask.title).toBe("Subtask 1");
      expect(subtask.task_id).toBe(task.id);
      expect(subtask.completed).toBe(false);
      expect(subtask.position).toBe(1);
      expect(subtask.id).toBeDefined();
    });

    it("auto-increments position", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const s1 = await caller.subtask.create({ taskId: task.id, title: "First" });
      const s2 = await caller.subtask.create({ taskId: task.id, title: "Second" });
      expect(s2.position).toBeGreaterThan(s1.position);
    });
  });

  describe("list", () => {
    it("lists subtasks for a task ordered by position", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.subtask.create({ taskId: task.id, title: "First" });
      await caller.subtask.create({ taskId: task.id, title: "Second" });

      const subtasks = await caller.subtask.list({ taskId: task.id });
      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].title).toBe("First");
      expect(subtasks[1].title).toBe("Second");
    });

    it("returns empty list for task with no subtasks", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtasks = await caller.subtask.list({ taskId: task.id });
      expect(subtasks).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates subtask title", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtask = await caller.subtask.create({
        taskId: task.id,
        title: "Old Title",
      });
      const updated = await caller.subtask.update({
        subtaskId: subtask.id,
        title: "New Title",
      });
      expect(updated.title).toBe("New Title");
    });

    it("throws NOT_FOUND for non-existent subtask", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.subtask.update({ subtaskId: "nonexistent", title: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a subtask", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtask = await caller.subtask.create({
        taskId: task.id,
        title: "To be deleted",
      });
      const result = await caller.subtask.delete({ subtaskId: subtask.id });
      expect(result.success).toBe(true);

      const subtasks = await caller.subtask.list({ taskId: task.id });
      expect(subtasks).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent subtask", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.subtask.delete({ subtaskId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("toggle", () => {
    it("toggles subtask completed state", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtask = await caller.subtask.create({
        taskId: task.id,
        title: "Toggle me",
      });
      expect(subtask.completed).toBe(false);

      const toggled = await caller.subtask.toggle({ subtaskId: subtask.id });
      expect(toggled.completed).toBe(true);

      const toggledBack = await caller.subtask.toggle({ subtaskId: subtask.id });
      expect(toggledBack.completed).toBe(false);
    });

    it("throws NOT_FOUND for non-existent subtask", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.subtask.toggle({ subtaskId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("move", () => {
    it("moves a subtask to a new position", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const subtask = await caller.subtask.create({
        taskId: task.id,
        title: "Movable",
      });
      const result = await caller.subtask.move({ subtaskId: subtask.id, position: 5 });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for non-existent subtask", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.subtask.move({ subtaskId: "nonexistent", position: 0 }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });
});
