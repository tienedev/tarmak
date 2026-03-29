import { describe, expect, it, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, migrateDb, notificationsRepo } from "@tarmak/db";
import {
  NotificationBroadcaster,
  type NotificationEvent,
} from "../notifications/broadcaster";
import { checkDeadlines } from "../background/deadlines";
import { cleanupSessions } from "../background/sessions";

function createTestDb() {
  const db = createDb();
  migrateDb(db);
  // Seed board and user for foreign key constraints
  db.run(
    sql`INSERT INTO boards (id, name) VALUES ('board-1', 'Test Board')`,
  );
  db.run(
    sql`INSERT INTO users (id, name, email) VALUES ('user-1', 'Alice', 'alice@test.com')`,
  );
  db.run(
    sql`INSERT INTO users (id, name, email) VALUES ('user-2', 'Bob', 'bob@test.com')`,
  );
  db.run(
    sql`INSERT INTO columns (id, board_id, name, position) VALUES ('col-1', 'board-1', 'Todo', 0)`,
  );
  return db;
}

describe("NotificationBroadcaster", () => {
  let broadcaster: NotificationBroadcaster;

  beforeEach(() => {
    broadcaster = new NotificationBroadcaster();
  });

  it("sends events to subscribed users", () => {
    const received: NotificationEvent[] = [];
    broadcaster.subscribe("user-1", (event) => received.push(event));

    const event: NotificationEvent = {
      userId: "user-1",
      type: "deadline_overdue",
      title: "Task is overdue",
      boardId: "board-1",
      taskId: "task-1",
    };
    broadcaster.send(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it("does not send events to other users", () => {
    const received: NotificationEvent[] = [];
    broadcaster.subscribe("user-2", (event) => received.push(event));

    broadcaster.send({
      userId: "user-1",
      type: "deadline_overdue",
      title: "Task is overdue",
      boardId: "board-1",
    });

    expect(received).toHaveLength(0);
  });

  it("unsubscribe stops receiving events", () => {
    const received: NotificationEvent[] = [];
    const unsubscribe = broadcaster.subscribe("user-1", (event) =>
      received.push(event),
    );

    broadcaster.send({
      userId: "user-1",
      type: "test",
      title: "First",
      boardId: "board-1",
    });
    expect(received).toHaveLength(1);

    unsubscribe();

    broadcaster.send({
      userId: "user-1",
      type: "test",
      title: "Second",
      boardId: "board-1",
    });
    expect(received).toHaveLength(1);
  });

  it("supports multiple subscribers for the same user", () => {
    const received1: NotificationEvent[] = [];
    const received2: NotificationEvent[] = [];

    broadcaster.subscribe("user-1", (event) => received1.push(event));
    broadcaster.subscribe("user-1", (event) => received2.push(event));

    broadcaster.send({
      userId: "user-1",
      type: "test",
      title: "Hello",
      boardId: "board-1",
    });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });
});

describe("checkDeadlines", () => {
  it("creates notifications for overdue tasks", () => {
    const db = createTestDb();
    const broadcaster = new NotificationBroadcaster();
    const received: NotificationEvent[] = [];
    broadcaster.subscribe("user-1", (event) => received.push(event));

    // Insert a task with an overdue due_date
    const pastDate = new Date(Date.now() - 86_400_000).toISOString(); // 1 day ago
    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, assignee, due_date, archived, position)
          VALUES ('task-1', 'board-1', 'col-1', 'Overdue Task', 'user-1', ${pastDate}, 0, 0)`,
    );

    checkDeadlines(db, broadcaster);

    // Should have created a notification in the database
    const notifications = notificationsRepo.listNotifications(db, "user-1");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("deadline_overdue");
    expect(notifications[0]!.title).toContain("Overdue Task");

    // Should have broadcast an event
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("deadline_overdue");
  });

  it("does not notify for archived tasks", () => {
    const db = createTestDb();
    const broadcaster = new NotificationBroadcaster();

    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, assignee, due_date, archived, position)
          VALUES ('task-2', 'board-1', 'col-1', 'Archived Task', 'user-1', ${pastDate}, 1, 0)`,
    );

    checkDeadlines(db, broadcaster);

    const notifications = notificationsRepo.listNotifications(db, "user-1");
    expect(notifications).toHaveLength(0);
  });

  it("does not notify for tasks without assignee", () => {
    const db = createTestDb();
    const broadcaster = new NotificationBroadcaster();

    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, due_date, archived, position)
          VALUES ('task-3', 'board-1', 'col-1', 'Unassigned Task', ${pastDate}, 0, 0)`,
    );

    checkDeadlines(db, broadcaster);

    const notifications = notificationsRepo.listNotifications(db, "user-1");
    expect(notifications).toHaveLength(0);
  });

  it("does not notify for tasks without due_date", () => {
    const db = createTestDb();
    const broadcaster = new NotificationBroadcaster();

    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, assignee, archived, position)
          VALUES ('task-4', 'board-1', 'col-1', 'No Due Date', 'user-1', 0, 0)`,
    );

    checkDeadlines(db, broadcaster);

    const notifications = notificationsRepo.listNotifications(db, "user-1");
    expect(notifications).toHaveLength(0);
  });
});

describe("cleanupSessions", () => {
  it("removes expired auth sessions", () => {
    const db = createTestDb();

    // Insert an expired session
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    db.run(
      sql`INSERT INTO sessions (id, user_id, token_hash, expires_at)
          VALUES ('sess-1', 'user-1', 'hash-1', ${pastDate})`,
    );

    // Insert a valid session
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    db.run(
      sql`INSERT INTO sessions (id, user_id, token_hash, expires_at)
          VALUES ('sess-2', 'user-1', 'hash-2', ${futureDate})`,
    );

    cleanupSessions(db);

    const remaining = db.run(sql`SELECT COUNT(*) as count FROM sessions`);
    // Check that only the valid session remains
    const rows = db.all(sql`SELECT id FROM sessions`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe("sess-2");
  });

  it("marks stale agent sessions as failed", () => {
    const db = createTestDb();

    // Insert tasks for the agent session FK (unique index requires different tasks per running session)
    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, position)
          VALUES ('task-1', 'board-1', 'col-1', 'Test Task 1', 0)`,
    );
    db.run(
      sql`INSERT INTO tasks (id, board_id, column_id, title, position)
          VALUES ('task-2', 'board-1', 'col-1', 'Test Task 2', 1)`,
    );

    // Insert a stale running agent session (started 2 hours ago)
    const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
    db.run(
      sql`INSERT INTO agent_sessions (id, board_id, task_id, user_id, status, started_at)
          VALUES ('agent-1', 'board-1', 'task-1', 'user-1', 'running', ${twoHoursAgo})`,
    );

    // Insert a recent running agent session (started 5 minutes ago)
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
    db.run(
      sql`INSERT INTO agent_sessions (id, board_id, task_id, user_id, status, started_at)
          VALUES ('agent-2', 'board-1', 'task-2', 'user-2', 'running', ${fiveMinAgo})`,
    );

    cleanupSessions(db);

    // Stale session should be marked as failed
    const stale = db.all(
      sql`SELECT id, status FROM agent_sessions WHERE id = 'agent-1'`,
    );
    expect(stale).toHaveLength(1);
    expect((stale[0] as { status: string }).status).toBe("failed");

    // Recent session should still be running
    const recent = db.all(
      sql`SELECT id, status FROM agent_sessions WHERE id = 'agent-2'`,
    );
    expect(recent).toHaveLength(1);
    expect((recent[0] as { status: string }).status).toBe("running");
  });
});
