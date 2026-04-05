import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, attachmentsRepo } from "@tarmak/db";
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

function seedAttachment(ctx: Context, taskId: string, boardId: string) {
  return attachmentsRepo.createAttachment(ctx.db, {
    taskId,
    boardId,
    filename: "test.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    storageKey: `uploads/${crypto.randomUUID()}.png`,
    uploadedBy: ctx.user!.id,
  });
}

describe("attachment procedures", () => {
  describe("list", () => {
    it("lists attachments for a task", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      seedAttachment(ctx, task.id, board.id);
      seedAttachment(ctx, task.id, board.id);

      const attachments = await caller.attachment.list({ boardId: board.id, taskId: task.id });
      expect(attachments).toHaveLength(2);
    });

    it("returns empty list for task with no attachments", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const attachments = await caller.attachment.list({ boardId: board.id, taskId: task.id });
      expect(attachments).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("returns an attachment by id", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const attachment = seedAttachment(ctx, task.id, board.id);
      const fetched = await caller.attachment.get({ boardId: board.id, attachmentId: attachment.id });
      expect(fetched.filename).toBe("test.png");
      expect(fetched.mime_type).toBe("image/png");
      expect(fetched.size_bytes).toBe(1024);
    });

    it("throws NOT_FOUND for non-existent attachment", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.attachment.get({ boardId: board.id, attachmentId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes an attachment", async () => {
      const ctx = createTestContext();
      const { board, task } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      const attachment = seedAttachment(ctx, task.id, board.id);
      const result = await caller.attachment.delete({ boardId: board.id, attachmentId: attachment.id });
      expect(result.success).toBe(true);

      const attachments = await caller.attachment.list({ boardId: board.id, taskId: task.id });
      expect(attachments).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent attachment", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTask(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.attachment.delete({ boardId: board.id, attachmentId: "nonexistent" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });
});
