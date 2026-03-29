import { eq, and, sql, asc } from "drizzle-orm";
import type { DB } from "../connection";
import { tasks, columns } from "../schema/index";

export function archiveTask(db: DB, taskId: string) {
  const now = new Date().toISOString();
  const result = db
    .update(tasks)
    .set({ archived: true, updated_at: now })
    .where(eq(tasks.id, taskId))
    .run();
  return result.changes > 0;
}

export function unarchiveTask(db: DB, taskId: string) {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return false;

  // Check if the parent column is archived
  const column = db.select().from(columns).where(eq(columns.id, task.column_id)).get();

  let targetColumnId = task.column_id;

  if (column?.archived) {
    // Find the first active (non-archived) column in the same board
    const firstActiveColumn = db
      .select()
      .from(columns)
      .where(and(eq(columns.board_id, task.board_id), eq(columns.archived, false)))
      .orderBy(asc(columns.position))
      .limit(1)
      .get();

    if (!firstActiveColumn) return false; // No active columns to move to
    targetColumnId = firstActiveColumn.id;
  }

  // Compute position: place at end of target column
  const maxRow = db
    .select({ max: sql<number>`COALESCE(MAX(${tasks.position}), 0)` })
    .from(tasks)
    .where(and(eq(tasks.column_id, targetColumnId), eq(tasks.archived, false)))
    .get();
  const position = (maxRow?.max ?? 0) + 1;

  const now = new Date().toISOString();
  const result = db
    .update(tasks)
    .set({
      archived: false,
      column_id: targetColumnId,
      position,
      updated_at: now,
    })
    .where(eq(tasks.id, taskId))
    .run();

  return result.changes > 0;
}

export function listArchivedTasks(db: DB, boardId: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.board_id, boardId), eq(tasks.archived, true)))
    .orderBy(asc(tasks.updated_at))
    .all();
}

export function listArchivedColumns(db: DB, boardId: string) {
  return db
    .select()
    .from(columns)
    .where(and(eq(columns.board_id, boardId), eq(columns.archived, true)))
    .orderBy(asc(columns.position))
    .all();
}
