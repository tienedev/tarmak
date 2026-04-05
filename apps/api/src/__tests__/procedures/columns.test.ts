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

async function seedBoard(ctx: Context) {
  seedUser(ctx);
  const caller = appRouter.createCaller(ctx);
  return caller.board.create({ name: "Test Board" });
}

describe("column procedures", () => {
  describe("create", () => {
    it("creates a column", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Todo" });
      expect(col.name).toBe("Todo");
      expect(col.board_id).toBe(board.id);
    });

    it("creates a column with wip limit and color", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({
        boardId: board.id,
        name: "In Progress",
        wipLimit: 5,
        color: "#ff0000",
      });
      expect(col.wip_limit).toBe(5);
      expect(col.color).toBe("#ff0000");
    });

    it("auto-increments position", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col1 = await caller.column.create({ boardId: board.id, name: "A" });
      const col2 = await caller.column.create({ boardId: board.id, name: "B" });
      expect(col2.position).toBeGreaterThan(col1.position);
    });
  });

  describe("list", () => {
    it("lists columns for a board", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.column.create({ boardId: board.id, name: "Todo" });
      await caller.column.create({ boardId: board.id, name: "Done" });

      const cols = await caller.column.list({ boardId: board.id });
      expect(cols).toHaveLength(2);
    });

    it("excludes archived columns", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Old" });
      await caller.column.create({ boardId: board.id, name: "Active" });

      await caller.column.archive({ boardId: board.id, columnId: col.id });

      const cols = await caller.column.list({ boardId: board.id });
      expect(cols).toHaveLength(1);
      expect(cols[0].name).toBe("Active");
    });
  });

  describe("update", () => {
    it("updates column name", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Old" });
      const result = await caller.column.update({
        boardId: board.id,
        columnId: col.id,
        name: "New",
      });
      expect(result.success).toBe(true);
    });

    it("throws NOT_FOUND for missing column", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.column.update({ boardId: board.id, columnId: "none", name: "X" }),
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("delete", () => {
    it("deletes a column", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Todo" });
      const result = await caller.column.delete({ boardId: board.id, columnId: col.id });
      expect(result.success).toBe(true);

      const cols = await caller.column.list({ boardId: board.id });
      expect(cols).toHaveLength(0);
    });
  });

  describe("move", () => {
    it("changes column position", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Todo" });
      const result = await caller.column.move({
        boardId: board.id,
        columnId: col.id,
        position: 10,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("archive / unarchive", () => {
    it("archives and unarchives a column", async () => {
      const ctx = createTestContext();
      const board = await seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const col = await caller.column.create({ boardId: board.id, name: "Todo" });

      await caller.column.archive({ boardId: board.id, columnId: col.id });
      let cols = await caller.column.list({ boardId: board.id });
      expect(cols).toHaveLength(0);

      await caller.column.unarchive({ boardId: board.id, columnId: col.id });
      cols = await caller.column.list({ boardId: board.id });
      expect(cols).toHaveLength(1);
    });
  });
});
