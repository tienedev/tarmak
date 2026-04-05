import { eq, and, sql, desc } from "drizzle-orm";
import type { DB } from "../connection";
import { notifications } from "../schema/index";

export function createNotification(
  db: DB,
  opts: {
    userId: string;
    boardId: string;
    taskId?: string;
    type: string;
    title: string;
    body?: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(notifications)
    .values({
      id,
      user_id: opts.userId,
      board_id: opts.boardId,
      task_id: opts.taskId ?? null,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      read: false,
      created_at: now,
    })
    .run();

  return db.select().from(notifications).where(eq(notifications.id, id)).get()!;
}

export function listNotifications(
  db: DB,
  userId: string,
  limit?: number,
  unreadOnly?: boolean,
  offset?: number,
) {
  const conditions = [eq(notifications.user_id, userId)];
  if (unreadOnly) {
    conditions.push(eq(notifications.read, false));
  }

  let query = db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.created_at))
    .$dynamic();

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  if (offset !== undefined) {
    query = query.offset(offset);
  }

  return query.all();
}

export function markRead(db: DB, id: string, userId: string) {
  const result = db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
    .run();
  return result.changes > 0;
}

export function markAllRead(db: DB, userId: string) {
  const result = db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)))
    .run();
  return result.changes;
}

export function deleteNotification(db: DB, id: string, userId: string) {
  const result = db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
    .run();
  return result.changes > 0;
}

export function hasDeadlineNotification(
  db: DB,
  taskId: string,
  userId: string,
) {
  const row = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.task_id, taskId),
        eq(notifications.user_id, userId),
        eq(notifications.type, "deadline_overdue"),
      ),
    )
    .get();
  return (row?.count ?? 0) > 0;
}

export function getUnreadCount(db: DB, userId: string) {
  const row = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)))
    .get();
  return row?.count ?? 0;
}
