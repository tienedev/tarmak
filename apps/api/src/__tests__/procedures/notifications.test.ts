import { createDb, migrateDb, notificationsRepo } from "@tarmak/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TicketStore } from "../../notifications/ticket-store";
import type { Context } from "../../trpc/context";
import { setTicketStore } from "../../trpc/procedures/notifications";
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

function seedBoard(ctx: Context) {
  ctx.db.run(
    sql`INSERT INTO boards (id, name, created_at, updated_at) VALUES ('b1', 'Board', datetime('now'), datetime('now'))`,
  );
}

function seedNotification(ctx: Context, overrides?: { id?: string; read?: boolean }) {
  return notificationsRepo.createNotification(ctx.db, {
    userId: ctx.user!.id,
    boardId: "b1",
    type: "task_assigned",
    title: "You were assigned a task",
    body: "Check it out",
  });
}

describe("notification procedures", () => {
  describe("createStreamTicket", () => {
    it("creates a ticket for the authenticated user", async () => {
      const store = new TicketStore();
      setTicketStore(store);

      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.notification.createStreamTicket();
      expect(result.ticket).toBeTruthy();

      // Ticket should resolve to the user's id
      const userId = store.consume(result.ticket);
      expect(userId).toBe("u1");
    });
  });
  describe("list", () => {
    it("lists notifications for the current user", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      seedNotification(ctx);
      seedNotification(ctx);

      const list = await caller.notification.list();
      expect(list).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      seedNotification(ctx);
      seedNotification(ctx);
      seedNotification(ctx);

      const list = await caller.notification.list({ limit: 2 });
      expect(list).toHaveLength(2);
    });

    it("filters unread only", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const n1 = seedNotification(ctx);
      seedNotification(ctx);

      // Mark one as read
      notificationsRepo.markRead(ctx.db, n1.id, ctx.user!.id);

      const list = await caller.notification.list({ unreadOnly: true });
      expect(list).toHaveLength(1);
    });

    it("returns empty list when no notifications exist", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const list = await caller.notification.list();
      expect(list).toHaveLength(0);
    });
  });

  describe("markRead", () => {
    it("marks a notification as read", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const n = seedNotification(ctx);

      const result = await caller.notification.markRead({ id: n.id });
      expect(result.success).toBe(true);

      const list = await caller.notification.list({ unreadOnly: true });
      expect(list).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent notification", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.notification.markRead({ id: "nonexistent" })).rejects.toThrow(
        "NOT_FOUND",
      );
    });
  });

  describe("markAllRead", () => {
    it("marks all notifications as read", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      seedNotification(ctx);
      seedNotification(ctx);
      seedNotification(ctx);

      const result = await caller.notification.markAllRead();
      expect(result.count).toBe(3);

      const list = await caller.notification.list({ unreadOnly: true });
      expect(list).toHaveLength(0);
    });

    it("returns 0 when no unread notifications", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.notification.markAllRead();
      expect(result.count).toBe(0);
    });
  });

  describe("delete", () => {
    it("deletes a notification", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      const n = seedNotification(ctx);

      const result = await caller.notification.delete({ id: n.id });
      expect(result.success).toBe(true);

      const list = await caller.notification.list();
      expect(list).toHaveLength(0);
    });

    it("throws NOT_FOUND for non-existent notification", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.notification.delete({ id: "nonexistent" })).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("unreadCount", () => {
    it("returns the count of unread notifications", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      seedBoard(ctx);
      const caller = appRouter.createCaller(ctx);

      seedNotification(ctx);
      seedNotification(ctx);
      const n3 = seedNotification(ctx);
      notificationsRepo.markRead(ctx.db, n3.id, ctx.user!.id);

      const result = await caller.notification.unreadCount();
      expect(result.count).toBe(2);
    });

    it("returns 0 when no notifications", async () => {
      const ctx = createTestContext();
      seedUser(ctx);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.notification.unreadCount();
      expect(result.count).toBe(0);
    });
  });
});
