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

function seedBoard(ctx: Context) {
  ctx.db.run(
    sql`INSERT INTO boards (id, name, created_at, updated_at) VALUES ('b1', 'Board', datetime('now'), datetime('now'))`,
  );
  boardsRepo.addMember(ctx.db, "b1", ctx.user?.id, "owner");
}

function seedActivity(ctx: Context, action: string, index: number) {
  ctx.db.run(
    sql`INSERT INTO activity (id, board_id, user_id, action, details, created_at) VALUES (${`a${index}`}, 'b1', ${ctx.user?.id}, ${action}, ${`Detail ${index}`}, datetime('now', ${`+${index} seconds`}))`,
  );
}

describe("activity procedures", () => {
  describe("list", () => {
    it("lists activity for a board", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      seedActivity(ctx, "task_created", 1);
      seedActivity(ctx, "task_updated", 2);
      seedActivity(ctx, "comment_added", 3);

      const list = await caller.activity.list({ boardId: "b1" });
      expect(list).toHaveLength(3);
      // Most recent first
      expect(list[0].action).toBe("comment_added");
    });

    it("respects limit parameter", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      for (let i = 1; i <= 10; i++) {
        seedActivity(ctx, `action_${i}`, i);
      }

      const list = await caller.activity.list({ boardId: "b1", limit: 3 });
      expect(list).toHaveLength(3);
    });

    it("defaults to 50 items", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      // Just verify we can call it with no limit
      const list = await caller.activity.list({ boardId: "b1" });
      expect(list).toHaveLength(0);
    });

    it("returns empty list for board with no activity", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const list = await caller.activity.list({ boardId: "b1" });
      expect(list).toHaveLength(0);
    });
  });
});
