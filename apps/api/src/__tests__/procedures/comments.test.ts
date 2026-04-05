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

describe("comment procedures", () => {
  describe("create", () => {
    it("creates a comment on a task", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const comment = await caller.comment.create({
        taskId: task.id,
        content: "This is a comment",
      });
      expect(comment.content).toBe("This is a comment");
      expect(comment.task_id).toBe(task.id);
      expect(comment.user_id).toBe("u1");
      expect(comment.id).toBeDefined();
    });
  });

  describe("list", () => {
    it("lists comments for a task", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.comment.create({ taskId: task.id, content: "First" });
      await caller.comment.create({ taskId: task.id, content: "Second" });

      const comments = await caller.comment.list({ taskId: task.id });
      expect(comments).toHaveLength(2);
      expect(comments[0].user_name).toBe("Test User");
    });

    it("returns empty list for task with no comments", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const comments = await caller.comment.list({ taskId: task.id });
      expect(comments).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("updates a comment", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const comment = await caller.comment.create({
        taskId: task.id,
        content: "Original",
      });
      const updated = await caller.comment.update({
        commentId: comment.id,
        content: "Updated",
      });
      expect(updated.content).toBe("Updated");
    });

    it("throws NOT_FOUND for non-existent comment", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.comment.update({ commentId: "nonexistent", content: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a comment", async () => {
      const ctx = createTestContext();
      const { task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const comment = await caller.comment.create({
        taskId: task.id,
        content: "To be deleted",
      });
      const result = await caller.comment.delete({ commentId: comment.id });
      expect(result.success).toBe(true);

      const comments = await caller.comment.list({ taskId: task.id });
      expect(comments).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent comment", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.comment.delete({ commentId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });
});
