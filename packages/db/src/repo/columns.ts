import { eq, and, sql } from "drizzle-orm";
import type { DB } from "../connection";
import { columns } from "../schema/index";
import { tasks } from "../schema/index";

export function createColumn(
  db: DB,
  boardId: string,
  name: string,
  wipLimit?: number,
  color?: string,
) {
  const id = crypto.randomUUID();

  // Auto-position: MAX(position) + 1 in board
  const maxRow = db
    .select({ max: sql<number>`COALESCE(MAX(${columns.position}), 0)` })
    .from(columns)
    .where(eq(columns.board_id, boardId))
    .get();
  const position = (maxRow?.max ?? 0) + 1;

  db.insert(columns)
    .values({
      id,
      board_id: boardId,
      name,
      position,
      wip_limit: wipLimit ?? null,
      color: color ?? null,
      archived: false,
    })
    .run();

  return db.select().from(columns).where(eq(columns.id, id)).get()!;
}

export function listColumns(db: DB, boardId: string) {
  return db
    .select()
    .from(columns)
    .where(and(eq(columns.board_id, boardId), eq(columns.archived, false)))
    .orderBy(columns.position)
    .all();
}

export function updateColumn(
  db: DB,
  id: string,
  data: { name?: string; wipLimit?: number; color?: string },
) {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.wipLimit !== undefined) updates.wip_limit = data.wipLimit;
  if (data.color !== undefined) updates.color = data.color;

  if (Object.keys(updates).length === 0) return false;

  const result = db.update(columns).set(updates).where(eq(columns.id, id)).run();
  return result.changes > 0;
}

export function deleteColumn(db: DB, id: string) {
  const result = db.delete(columns).where(eq(columns.id, id)).run();
  return result.changes > 0;
}

export function moveColumn(db: DB, id: string, newPosition: number) {
  const result = db
    .update(columns)
    .set({ position: newPosition })
    .where(eq(columns.id, id))
    .run();
  return result.changes > 0;
}

export function archiveColumn(db: DB, columnId: string) {
  return db.transaction(() => {
    db.update(columns).set({ archived: true }).where(eq(columns.id, columnId)).run();
    const result = db
      .update(tasks)
      .set({ archived: true })
      .where(eq(tasks.column_id, columnId))
      .run();
    return result.changes;
  });
}

export function unarchiveColumn(db: DB, columnId: string) {
  return db.transaction(() => {
    db.update(columns).set({ archived: false }).where(eq(columns.id, columnId)).run();
    const result = db
      .update(tasks)
      .set({ archived: false })
      .where(eq(tasks.column_id, columnId))
      .run();
    return result.changes;
  });
}
