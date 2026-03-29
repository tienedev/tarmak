import { eq, asc } from "drizzle-orm";
import type { DB } from "../connection";
import { comments, users } from "../schema/index";

export function createComment(db: DB, taskId: string, userId: string, content: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(comments)
    .values({ id, task_id: taskId, user_id: userId, content, created_at: now })
    .run();

  return db.select().from(comments).where(eq(comments.id, id)).get()!;
}

export function listComments(db: DB, taskId: string) {
  return db
    .select({
      id: comments.id,
      task_id: comments.task_id,
      user_id: comments.user_id,
      content: comments.content,
      created_at: comments.created_at,
      updated_at: comments.updated_at,
      user_name: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(comments.user_id, users.id))
    .where(eq(comments.task_id, taskId))
    .orderBy(asc(comments.created_at))
    .all();
}

export function updateComment(db: DB, id: string, content: string) {
  const existing = db.select().from(comments).where(eq(comments.id, id)).get();
  if (!existing) return null;

  const now = new Date().toISOString();
  db.update(comments)
    .set({ content, updated_at: now })
    .where(eq(comments.id, id))
    .run();

  return db.select().from(comments).where(eq(comments.id, id)).get()!;
}

export function deleteComment(db: DB, id: string) {
  const result = db.delete(comments).where(eq(comments.id, id)).run();
  return result.changes > 0;
}
