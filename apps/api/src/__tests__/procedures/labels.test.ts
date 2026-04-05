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

async function seedBoard(ctx: Context) {
  seedUser(ctx);
  const caller = appRouter.createCaller(ctx);
  const board = await caller.board.create({ name: "Test Board" });
  const column = await caller.column.create({ boardId: board.id, name: "Todo" });
  return { board, column };
}

describe("label procedures", () => {
  describe("create", () => {
    it("creates a label for a board", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const label = await caller.label.create({
        boardId: board.id,
        name: "Bug",
        color: "#ff0000",
      });
      expect(label.name).toBe("Bug");
      expect(label.color).toBe("#ff0000");
      expect(label.board_id).toBe(board.id);
      expect(label.id).toBeDefined();
    });
  });

  describe("list", () => {
    it("lists labels for a board", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.label.create({ boardId: board.id, name: "Bug", color: "#ff0000" });
      await caller.label.create({ boardId: board.id, name: "Feature", color: "#00ff00" });

      const labels = await caller.label.list({ boardId: board.id });
      expect(labels).toHaveLength(2);
    });

    it("returns empty list for board with no labels", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const labels = await caller.label.list({ boardId: board.id });
      expect(labels).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates label name", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const label = await caller.label.create({
        boardId: board.id,
        name: "Old",
        color: "#000",
      });
      const result = await caller.label.update({
        boardId: board.id,
        labelId: label.id,
        name: "New",
      });
      expect(result.success).toBe(true);
    });

    it("updates label color", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const label = await caller.label.create({
        boardId: board.id,
        name: "Bug",
        color: "#000",
      });
      const result = await caller.label.update({
        boardId: board.id,
        labelId: label.id,
        color: "#fff",
      });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for non-existent label", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.label.update({ boardId: board.id, labelId: "nonexistent", name: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a label", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const label = await caller.label.create({
        boardId: board.id,
        name: "Bug",
        color: "#ff0000",
      });
      const result = await caller.label.delete({ boardId: board.id, labelId: label.id });
      expect(result.success).toBe(true);

      const labels = await caller.label.list({ boardId: board.id });
      expect(labels).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent label", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.label.delete({ boardId: board.id, labelId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("addToTask / removeFromTask / listForTask", () => {
    it("adds a label to a task and lists it", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 1",
      });
      const label = await caller.label.create({
        boardId: board.id,
        name: "Bug",
        color: "#ff0000",
      });

      await caller.label.addToTask({ boardId: board.id, taskId: task.id, labelId: label.id });
      const taskLabels = await caller.label.listForTask({ boardId: board.id, taskId: task.id });
      expect(taskLabels).toHaveLength(1);
      expect(taskLabels[0].name).toBe("Bug");
    });

    it("removes a label from a task", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 1",
      });
      const label = await caller.label.create({
        boardId: board.id,
        name: "Bug",
        color: "#ff0000",
      });

      await caller.label.addToTask({ boardId: board.id, taskId: task.id, labelId: label.id });
      await caller.label.removeFromTask({ boardId: board.id, taskId: task.id, labelId: label.id });

      const taskLabels = await caller.label.listForTask({ boardId: board.id, taskId: task.id });
      expect(taskLabels).toHaveLength(0);
    });

    it("returns empty list for task with no labels", async () => {
      const ctx = createTestContext();
      const { board, column } = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const task = await caller.task.create({
        boardId: board.id,
        columnId: column.id,
        title: "Task 1",
      });

      const taskLabels = await caller.label.listForTask({ boardId: board.id, taskId: task.id });
      expect(taskLabels).toHaveLength(0);
    });
  });
});
