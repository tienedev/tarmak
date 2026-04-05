import { asc, eq, sql } from "drizzle-orm";
import type { DB } from "../connection";
import { subtasks } from "../schema/index";

export function createSubtask(db: DB, taskId: string, title: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Auto-position: MAX(position) + 1 for this task
  const maxRow = db
    .select({ max: sql<number>`COALESCE(MAX(${subtasks.position}), 0)` })
    .from(subtasks)
    .where(eq(subtasks.task_id, taskId))
    .get();
  const position = (maxRow?.max ?? 0) + 1;

  db.insert(subtasks)
    .values({ id, task_id: taskId, title, completed: false, position, created_at: now })
    .run();

  return db.select().from(subtasks).where(eq(subtasks.id, id)).get()!;
}

export function listSubtasks(db: DB, taskId: string) {
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.task_id, taskId))
    .orderBy(asc(subtasks.position))
    .all();
}

export function toggleSubtask(db: DB, id: string) {
  const existing = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
  if (!existing) return null;

  db.update(subtasks).set({ completed: !existing.completed }).where(eq(subtasks.id, id)).run();

  return db.select().from(subtasks).where(eq(subtasks.id, id)).get()!;
}

export function updateSubtask(db: DB, id: string, title: string) {
  const existing = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
  if (!existing) return null;

  db.update(subtasks).set({ title }).where(eq(subtasks.id, id)).run();

  return db.select().from(subtasks).where(eq(subtasks.id, id)).get()!;
}

export function deleteSubtask(db: DB, id: string) {
  const result = db.delete(subtasks).where(eq(subtasks.id, id)).run();
  return result.changes > 0;
}

export function moveSubtask(db: DB, id: string, newPosition: number) {
  const result = db
    .update(subtasks)
    .set({ position: newPosition })
    .where(eq(subtasks.id, id))
    .run();
  return result.changes > 0;
}

export function getSubtaskCount(db: DB, taskId: string): { completed: number; total: number } {
  const result = db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`sum(case when ${subtasks.completed} then 1 else 0 end)`,
    })
    .from(subtasks)
    .where(eq(subtasks.task_id, taskId))
    .get();

  return {
    total: result?.total ?? 0,
    completed: result?.completed ?? 0,
  };
}
