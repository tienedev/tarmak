import { eq, and, sql } from "drizzle-orm";
import type { FieldType } from "@tarmak/shared";
import type { DB } from "../connection";
import { customFields, taskCustomFieldValues } from "../schema/index";

export function createCustomField(
  db: DB,
  boardId: string,
  name: string,
  fieldType: FieldType,
  config?: string,
) {
  const id = crypto.randomUUID();

  // Auto-position: MAX(position) + 1 for this board
  const maxRow = db
    .select({ max: sql<number>`COALESCE(MAX(${customFields.position}), 0)` })
    .from(customFields)
    .where(eq(customFields.board_id, boardId))
    .get();
  const position = (maxRow?.max ?? 0) + 1;

  db.insert(customFields)
    .values({
      id,
      board_id: boardId,
      name,
      field_type: fieldType,
      config: config ?? null,
      position,
    })
    .run();

  return db.select().from(customFields).where(eq(customFields.id, id)).get()!;
}

export function listCustomFields(db: DB, boardId: string) {
  return db
    .select()
    .from(customFields)
    .where(eq(customFields.board_id, boardId))
    .orderBy(customFields.position)
    .all();
}

export function updateCustomField(
  db: DB,
  id: string,
  data: { name?: string; config?: string; position?: number },
) {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.config !== undefined) updates.config = data.config;
  if (data.position !== undefined) updates.position = data.position;

  if (Object.keys(updates).length === 0) return false;

  const result = db.update(customFields).set(updates).where(eq(customFields.id, id)).run();
  return result.changes > 0;
}

export function deleteCustomField(db: DB, id: string) {
  const result = db.delete(customFields).where(eq(customFields.id, id)).run();
  return result.changes > 0;
}

export function setFieldValue(db: DB, taskId: string, fieldId: string, value: string) {
  db.run(
    sql`INSERT OR REPLACE INTO task_custom_field_values (task_id, field_id, value) VALUES (${taskId}, ${fieldId}, ${value})`,
  );
}

export function getFieldValues(db: DB, taskId: string) {
  return db
    .select()
    .from(taskCustomFieldValues)
    .where(eq(taskCustomFieldValues.task_id, taskId))
    .all();
}

export function deleteFieldValue(db: DB, taskId: string, fieldId: string) {
  const result = db
    .delete(taskCustomFieldValues)
    .where(
      and(
        eq(taskCustomFieldValues.task_id, taskId),
        eq(taskCustomFieldValues.field_id, fieldId),
      ),
    )
    .run();
  return result.changes > 0;
}
