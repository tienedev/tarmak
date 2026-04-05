import { eq, and } from "drizzle-orm";
import type { DB } from "../connection";
import { labels, taskLabels } from "../schema/index";

export function createLabel(db: DB, boardId: string, name: string, color: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(labels)
    .values({ id, board_id: boardId, name, color, created_at: now })
    .run();

  return db.select().from(labels).where(eq(labels.id, id)).get()!;
}

export function listLabels(db: DB, boardId: string) {
  return db
    .select()
    .from(labels)
    .where(eq(labels.board_id, boardId))
    .all();
}

export function updateLabel(db: DB, id: string, data: { name?: string; color?: string }) {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.color !== undefined) updates.color = data.color;

  if (Object.keys(updates).length === 0) return false;

  const result = db.update(labels).set(updates).where(eq(labels.id, id)).run();
  return result.changes > 0;
}

export function deleteLabel(db: DB, id: string) {
  const result = db.delete(labels).where(eq(labels.id, id)).run();
  return result.changes > 0;
}

export function attachLabel(db: DB, taskId: string, labelId: string) {
  db.insert(taskLabels)
    .values({ task_id: taskId, label_id: labelId })
    .run();
}

export function detachLabel(db: DB, taskId: string, labelId: string) {
  db.delete(taskLabels)
    .where(and(eq(taskLabels.task_id, taskId), eq(taskLabels.label_id, labelId)))
    .run();
}

export function getTaskLabels(db: DB, taskId: string) {
  const rows = db
    .select({ label: labels })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.label_id, labels.id))
    .where(eq(taskLabels.task_id, taskId))
    .all();

  return rows.map((r) => r.label);
}
