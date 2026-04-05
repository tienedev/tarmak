import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import type { DB } from "../../connection";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import {
  createNotification,
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
} from "../../repo/notifications";
import { createTask } from "../../repo/tasks";
import { users } from "../../schema/users";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedUser(db: DB) {
  db.insert(users).values({ id: "user-1", name: "Alice", email: "alice@test.com" }).run();
  return "user-1";
}

describe("notifications repo", () => {
  describe("createNotification", () => {
    it("creates a notification with required fields", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      const notif = createNotification(db, {
        userId,
        boardId: board.id,
        type: "task_assigned",
        title: "You were assigned a task",
      });

      expect(notif.id).toBeDefined();
      expect(notif.user_id).toBe(userId);
      expect(notif.board_id).toBe(board.id);
      expect(notif.task_id).toBeNull();
      expect(notif.type).toBe("task_assigned");
      expect(notif.title).toBe("You were assigned a task");
      expect(notif.body).toBeNull();
      expect(notif.read).toBe(false);
      expect(notif.created_at).toBeDefined();
    });

    it("creates a notification with optional fields", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const notif = createNotification(db, {
        userId,
        boardId: board.id,
        taskId: task.id,
        type: "comment",
        title: "New comment",
        body: "Someone commented on your task",
      });

      expect(notif.task_id).toBe(task.id);
      expect(notif.body).toBe("Someone commented on your task");
    });
  });

  describe("listNotifications", () => {
    it("returns all notifications for a user", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      createNotification(db, { userId, boardId: board.id, type: "a", title: "First" });
      createNotification(db, { userId, boardId: board.id, type: "b", title: "Second" });
      createNotification(db, { userId, boardId: board.id, type: "c", title: "Third" });

      const all = listNotifications(db, userId);
      expect(all).toHaveLength(3);
      const titles = all.map((n) => n.title).sort();
      expect(titles).toEqual(["First", "Second", "Third"]);
    });

    it("respects limit parameter", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      createNotification(db, { userId, boardId: board.id, type: "a", title: "First" });
      createNotification(db, { userId, boardId: board.id, type: "b", title: "Second" });
      createNotification(db, { userId, boardId: board.id, type: "c", title: "Third" });

      const limited = listNotifications(db, userId, 2);
      expect(limited).toHaveLength(2);
    });

    it("filters unread only", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      const n1 = createNotification(db, { userId, boardId: board.id, type: "a", title: "Read" });
      createNotification(db, { userId, boardId: board.id, type: "b", title: "Unread" });

      markRead(db, n1.id, userId);

      const unread = listNotifications(db, userId, undefined, true);
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe("Unread");
    });

    it("does not return other users notifications", () => {
      const db = setup();
      const userId = seedUser(db);
      db.insert(users).values({ id: "user-2", name: "Bob", email: "bob@test.com" }).run();
      const board = createBoard(db, "Board");

      createNotification(db, { userId, boardId: board.id, type: "a", title: "For Alice" });
      createNotification(db, { userId: "user-2", boardId: board.id, type: "b", title: "For Bob" });

      const aliceNotifs = listNotifications(db, userId);
      expect(aliceNotifs).toHaveLength(1);
      expect(aliceNotifs[0].title).toBe("For Alice");
    });
  });

  describe("markRead", () => {
    it("marks a notification as read", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      const notif = createNotification(db, { userId, boardId: board.id, type: "a", title: "Test" });
      expect(notif.read).toBe(false);

      const result = markRead(db, notif.id, userId);
      expect(result).toBe(true);

      const all = listNotifications(db, userId);
      expect(all[0].read).toBe(true);
    });

    it("returns false for non-existent notification", () => {
      const db = setup();
      const userId = seedUser(db);
      expect(markRead(db, "nonexistent", userId)).toBe(false);
    });
  });

  describe("markAllRead", () => {
    it("marks all unread notifications for a user as read", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      createNotification(db, { userId, boardId: board.id, type: "a", title: "N1" });
      createNotification(db, { userId, boardId: board.id, type: "b", title: "N2" });
      createNotification(db, { userId, boardId: board.id, type: "c", title: "N3" });

      const count = markAllRead(db, userId);
      expect(count).toBe(3);

      const unread = listNotifications(db, userId, undefined, true);
      expect(unread).toHaveLength(0);
    });

    it("returns 0 when no unread notifications", () => {
      const db = setup();
      const userId = seedUser(db);

      const count = markAllRead(db, userId);
      expect(count).toBe(0);
    });
  });

  describe("deleteNotification", () => {
    it("deletes a notification", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      const notif = createNotification(db, { userId, boardId: board.id, type: "a", title: "Test" });
      expect(deleteNotification(db, notif.id, userId)).toBe(true);

      const all = listNotifications(db, userId);
      expect(all).toHaveLength(0);
    });

    it("returns false for non-existent notification", () => {
      const db = setup();
      expect(deleteNotification(db, "nonexistent", "nonexistent")).toBe(false);
    });
  });

  describe("getUnreadCount", () => {
    it("returns the count of unread notifications", () => {
      const db = setup();
      const userId = seedUser(db);
      const board = createBoard(db, "Board");

      createNotification(db, { userId, boardId: board.id, type: "a", title: "N1" });
      createNotification(db, { userId, boardId: board.id, type: "b", title: "N2" });
      const n3 = createNotification(db, { userId, boardId: board.id, type: "c", title: "N3" });

      expect(getUnreadCount(db, userId)).toBe(3);

      markRead(db, n3.id, userId);
      expect(getUnreadCount(db, userId)).toBe(2);
    });

    it("returns 0 when no notifications", () => {
      const db = setup();
      const userId = seedUser(db);
      expect(getUnreadCount(db, userId)).toBe(0);
    });
  });
});
