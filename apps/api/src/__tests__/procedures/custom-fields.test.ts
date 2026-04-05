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

describe("custom field procedures", () => {
  describe("create", () => {
    it("creates a custom field for a board", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Priority Score",
        fieldType: "number",
      });
      expect(field.name).toBe("Priority Score");
      expect(field.field_type).toBe("number");
      expect(field.board_id).toBe(board.id);
      expect(field.position).toBe(1);
      expect(field.id).toBeDefined();
    });

    it("creates a custom field with config", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const config = JSON.stringify({ options: ["low", "medium", "high"] });
      const field = await caller.customField.create({
        boardId: board.id,
        name: "Severity",
        fieldType: "enum",
        config,
      });
      expect(field.config).toBe(config);
    });

    it("auto-increments position", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const f1 = await caller.customField.create({
        boardId: board.id,
        name: "Field 1",
        fieldType: "text",
      });
      const f2 = await caller.customField.create({
        boardId: board.id,
        name: "Field 2",
        fieldType: "text",
      });
      expect(f2.position).toBeGreaterThan(f1.position);
    });
  });

  describe("list", () => {
    it("lists custom fields for a board", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.customField.create({ boardId: board.id, name: "F1", fieldType: "text" });
      await caller.customField.create({ boardId: board.id, name: "F2", fieldType: "number" });

      const fields = await caller.customField.list({ boardId: board.id });
      expect(fields).toHaveLength(2);
    });

    it("returns empty list for board with no custom fields", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const fields = await caller.customField.list({ boardId: board.id });
      expect(fields).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates custom field name", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Old Name",
        fieldType: "text",
      });
      const result = await caller.customField.update({ boardId: board.id, fieldId: field.id, name: "New Name" });
      expect(result.success).toBe(true);
    });

    it("updates custom field position", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Field",
        fieldType: "text",
      });
      const result = await caller.customField.update({ boardId: board.id, fieldId: field.id, position: 5 });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for non-existent field", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.customField.update({ boardId: board.id, fieldId: "nonexistent", name: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a custom field", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Field",
        fieldType: "text",
      });
      const result = await caller.customField.delete({ boardId: board.id, fieldId: field.id });
      expect(result.success).toBe(true);

      const fields = await caller.customField.list({ boardId: board.id });
      expect(fields).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent field", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.customField.delete({ boardId: board.id, fieldId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("setTaskValue / getTaskValues", () => {
    it("sets and gets custom field values for a task", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Score",
        fieldType: "number",
      });

      await caller.customField.setTaskValue({
        boardId: board.id,
        taskId: task.id,
        fieldId: field.id,
        value: "42",
      });

      const values = await caller.customField.getTaskValues({ boardId: board.id, taskId: task.id });
      expect(values).toHaveLength(1);
      expect(values[0].field_id).toBe(field.id);
      expect(values[0].value).toBe("42");
    });

    it("overwrites an existing value", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const field = await caller.customField.create({
        boardId: board.id,
        name: "Score",
        fieldType: "number",
      });

      await caller.customField.setTaskValue({
        boardId: board.id,
        taskId: task.id,
        fieldId: field.id,
        value: "10",
      });
      await caller.customField.setTaskValue({
        boardId: board.id,
        taskId: task.id,
        fieldId: field.id,
        value: "20",
      });

      const values = await caller.customField.getTaskValues({ boardId: board.id, taskId: task.id });
      expect(values).toHaveLength(1);
      expect(values[0].value).toBe("20");
    });

    it("returns empty list for task with no values", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const values = await caller.customField.getTaskValues({ boardId: board.id, taskId: task.id });
      expect(values).toHaveLength(0);
    });
  });
});
