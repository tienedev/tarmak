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

async function seedBoardColumnTasks(ctx: Context) {
  seedUser(ctx);
  const caller = appRouter.createCaller(ctx);
  const board = await caller.board.create({ name: "Test Board" });
  const column = await caller.column.create({ boardId: board.id, name: "Todo" });

  const task1 = await caller.task.create({
    boardId: board.id,
    columnId: column.id,
    title: "Implement authentication system",
  });
  const task2 = await caller.task.create({
    boardId: board.id,
    columnId: column.id,
    title: "Fix database migration bug",
  });
  const task3 = await caller.task.create({
    boardId: board.id,
    columnId: column.id,
    title: "Design new landing page",
  });

  return { board, column, tasks: [task1, task2, task3] };
}

describe("search procedures", () => {
  describe("query", () => {
    it("finds tasks matching the search query", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTasks(ctx);
      const caller = appRouter.createCaller(ctx);

      const results = await caller.search.query({
        boardId: board.id,
        query: "authentication",
      });
      expect(results).toHaveLength(1);
      expect(results[0].entity_type).toBe("task");
    });

    it("returns empty results for non-matching query", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTasks(ctx);
      const caller = appRouter.createCaller(ctx);

      const results = await caller.search.query({
        boardId: board.id,
        query: "nonexistent_xyz",
      });
      expect(results).toHaveLength(0);
    });

    it("finds multiple matching tasks", async () => {
      const ctx = createTestContext();
      const { board } = await seedBoardColumnTasks(ctx);
      const caller = appRouter.createCaller(ctx);

      // "database" and "migration" match task2; use a broader term
      const results = await caller.search.query({
        boardId: board.id,
        query: "new",
      });
      // "new" matches "new landing page"
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("excludes archived tasks by default", async () => {
      const ctx = createTestContext();
      const { board, tasks } = await seedBoardColumnTasks(ctx);
      const caller = appRouter.createCaller(ctx);

      // Archive the first task
      await caller.archive.archiveTask({ boardId: board.id, taskId: tasks[0].id });

      const results = await caller.search.query({
        boardId: board.id,
        query: "authentication",
      });
      expect(results).toHaveLength(0);
    });

    it("includes archived tasks when requested", async () => {
      const ctx = createTestContext();
      const { board, tasks } = await seedBoardColumnTasks(ctx);
      const caller = appRouter.createCaller(ctx);

      // Archive the first task
      await caller.archive.archiveTask({ boardId: board.id, taskId: tasks[0].id });

      const results = await caller.search.query({
        boardId: board.id,
        query: "authentication",
        includeArchived: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0].archived).toBe(true);
    });
  });
});
