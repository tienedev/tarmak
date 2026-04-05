import { boardsRepo, createDb, migrateDb } from "@tarmak/db";
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

describe("board procedures", () => {
  describe("create", () => {
    it("creates a board and adds creator as owner", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "My Board" });
      expect(board.name).toBe("My Board");
      expect(board.id).toBeDefined();

      const members = await caller.board.listMembers({ boardId: board.id });
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe("owner");
    });

    it("creates a board with description", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Board", description: "A test board" });
      expect(board.description).toBe("A test board");
    });
  });

  describe("list", () => {
    it("returns all boards", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await caller.board.create({ name: "Board 1" });
      await caller.board.create({ name: "Board 2" });

      const boards = await caller.board.list();
      expect(boards).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("returns a board by id", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Board" });
      const fetched = await caller.board.get({ boardId: board.id });
      expect(fetched.name).toBe("Board");
    });

    it("throws FORBIDDEN for non-member board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.board.get({ boardId: "nonexistent" })).rejects.toThrow(
        "Not a board member",
      );
    });
  });

  describe("update", () => {
    it("updates board name", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Old Name" });
      const updated = await caller.board.update({ boardId: board.id, name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    it("throws FORBIDDEN for non-member board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.board.update({ boardId: "none", name: "X" })).rejects.toThrow(
        "Not a board member",
      );
    });
  });

  describe("delete", () => {
    it("deletes a board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Board" });
      const result = await caller.board.delete({ boardId: board.id });
      expect(result.success).toBe(true);

      const boards = await caller.board.list();
      expect(boards).toHaveLength(0);
    });
  });

  describe("duplicate", () => {
    it("duplicates a board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Original" });
      await caller.column.create({ boardId: board.id, name: "Todo" });

      const copy = await caller.board.duplicate({
        boardId: board.id,
        newName: "Copy",
        includeTasks: false,
      });
      expect(copy.name).toBe("Copy");
    });
  });

  describe("members", () => {
    it("adds and removes a member", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const board = await caller.board.create({ name: "Board" });

      // Add another user
      ctx.db.run(sql`INSERT INTO users (id, name, email) VALUES ('u2', 'User 2', 'u2@test.com')`);

      await caller.board.addMember({ boardId: board.id, userId: "u2", role: "member" });
      let members = await caller.board.listMembers({ boardId: board.id });
      expect(members).toHaveLength(2);

      await caller.board.removeMember({ boardId: board.id, userId: "u2" });
      members = await caller.board.listMembers({ boardId: board.id });
      expect(members).toHaveLength(1);
    });
  });
});
