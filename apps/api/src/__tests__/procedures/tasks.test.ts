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

async function seedBoardAndColumn(ctx: Context) {
  seedUser(ctx);
  const caller = appRouter.createCaller(ctx);
  const board = await caller.board.create({ name: "Test Board" });
  const column = await caller.column.create({ boardId: board.id, name: "Todo" });
  return { board, column };
}

describe("task procedures", () => {
  describe("create", () => {
    it("creates a task with required fields", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "My Task",
      });
      expect(task.title).toBe("My Task");
      expect(task.board_id).toBe(board.id);
      expect(task.column_id).toBe(column.id);
      expect(task.priority).toBe("medium");
      expect(task.id).toBeDefined();
    });

    it("creates a task with all optional fields", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Full Task",
        description: "A detailed description",
        priority: "high",
        assignee: "u1",
      });
      expect(task.description).toBe("A detailed description");
      expect(task.priority).toBe("high");
      expect(task.assignee).toBe("u1");
    });

    it("auto-increments position", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const t1 = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 1",
      });
      const t2 = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 2",
      });
      expect(t2.position).toBeGreaterThan(t1.position);
    });
  });

  describe("get", () => {
    it("returns a task with relations", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task",
      });
      const fetched = await caller.task.get({ boardId: board.id, taskId: task.id });
      expect(fetched.title).toBe("Task");
      expect(fetched.labels).toEqual([]);
      expect(fetched.subtask_count).toEqual({ completed: 0, total: 0 });
      expect(fetched.attachment_count).toBe(0);
    });

    it("throws FORBIDDEN for non-member board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.task.get({ boardId: "nonexistent", taskId: "nonexistent" })).rejects.toThrow("Not a board member");
    });
  });

  describe("list", () => {
    it("lists tasks for a board", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.task.create({ boardId: board.id, columnId: column.id, title: "Task 1" });
      await caller.task.create({ boardId: board.id, columnId: column.id, title: "Task 2" });

      const tasks = await caller.task.list({ boardId: board.id });
      expect(tasks).toHaveLength(2);
    });

    it("supports limit and offset", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.task.create({ boardId: board.id, columnId: column.id, title: "Task 1" });
      await caller.task.create({ boardId: board.id, columnId: column.id, title: "Task 2" });
      await caller.task.create({ boardId: board.id, columnId: column.id, title: "Task 3" });

      const page = await caller.task.list({ boardId: board.id, limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
    });

    it("excludes archived tasks", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task",
      });

      // Archive the task directly via SQL
      ctx.db.run(sql`UPDATE tasks SET archived = 1 WHERE id = ${task.id}`);

      const tasks = await caller.task.list({ boardId: board.id });
      expect(tasks).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates task fields", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Old Title",
      });

      const updated = await caller.task.update({
        boardId: board.id,
        taskId: task.id,
        title: "New Title",
        description: "Added description",
        priority: "urgent",
      });
      expect(updated.title).toBe("New Title");
      expect(updated.description).toBe("Added description");
      expect(updated.priority).toBe("urgent");
    });

    it("throws NOT_FOUND for non-existent task", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.task.update({ boardId: board.id, taskId: "nonexistent", title: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a task", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task",
      });
      const result = await caller.task.delete({ boardId: board.id, taskId: task.id });
      expect(result.success).toBe(true);

      const tasks = await caller.task.list({ boardId: board.id });
      expect(tasks).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent task", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.task.delete({ boardId: board.id, taskId: "nonexistent" })).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("move", () => {
    it("moves a task to a different column and position", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const column2 = await caller.column.create({ boardId: board.id, name: "In Progress" });
      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task",
      });

      const moved = await caller.task.move({
        boardId: board.id,
        taskId: task.id,
        columnId: column2.id,
        position: 0,
      });
      expect(moved.column_id).toBe(column2.id);
      expect(moved.position).toBe(0);
    });

    it("throws NOT_FOUND for non-existent task", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.task.move({ boardId: board.id, taskId: "nonexistent", columnId: column.id, position: 0 }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("duplicate", () => {
    it("duplicates a task", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Original",
        description: "Some desc",
        priority: "high",
      });

      const copy = await caller.task.duplicate({ taskId: task.id, boardId: board.id });
      expect(copy.title).toBe("Copy of Original");
      expect(copy.description).toBe("Some desc");
      expect(copy.priority).toBe("high");
      expect(copy.assignee).toBeNull();
      expect(copy.column_id).toBe(column.id);
      expect(copy.id).not.toBe(task.id);
      expect(copy.labels).toEqual([]);
      expect(copy.subtask_count).toEqual({ completed: 0, total: 0 });
      expect(copy.attachment_count).toBe(0);
    });

    it("throws for non-existent task", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.task.duplicate({ taskId: "nonexistent", boardId: board.id }),
      ).rejects.toThrow();
    });
  });

  describe("claim and release", () => {
    it("claims an ai-ready task and releases it", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      // Create a task
      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "AI Task",
      });

      // Add an "ai-ready" label and link it
      const labelId = crypto.randomUUID();
      ctx.db.run(
        sql`INSERT INTO labels (id, board_id, name, color) VALUES (${labelId}, ${board.id}, 'ai-ready', '#00ff00')`,
      );
      ctx.db.run(
        sql`INSERT INTO task_labels (task_id, label_id) VALUES (${task.id}, ${labelId})`,
      );

      const claimed = await caller.task.claim({ boardId: board.id, agentId: "agent-1" });
      expect(claimed.task.id).toBe(task.id);
      expect(claimed.task.locked_by).toBe("agent-1");
      expect(claimed.labels).toContain("ai-ready");

      // Release the task
      const released = await caller.task.release({ boardId: board.id, taskId: task.id });
      expect(released.success).toBe(true);
    });

    it("throws NOT_FOUND when no claimable task exists", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardAndColumn(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.task.claim({ boardId: board.id, agentId: "agent-1" }),
      ).rejects.toThrow("No claimable task found");
    });
  });
});
