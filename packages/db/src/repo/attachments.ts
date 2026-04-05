import { eq, sql } from "drizzle-orm";
import type { DB } from "../connection";
import { attachments } from "../schema/index";

export function createAttachment(
  db: DB,
  opts: {
    taskId: string;
    boardId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    uploadedBy?: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(attachments)
    .values({
      id,
      task_id: opts.taskId,
      board_id: opts.boardId,
      filename: opts.filename,
      mime_type: opts.mimeType,
      size_bytes: opts.sizeBytes,
      storage_key: opts.storageKey,
      uploaded_by: opts.uploadedBy ?? null,
      created_at: now,
    })
    .run();

  return db.select().from(attachments).where(eq(attachments.id, id)).get()!;
}

export function listAttachments(db: DB, taskId: string) {
  return db.select().from(attachments).where(eq(attachments.task_id, taskId)).all();
}

export function getAttachment(db: DB, id: string) {
  return db.select().from(attachments).where(eq(attachments.id, id)).get() ?? null;
}

export function deleteAttachment(db: DB, id: string) {
  const result = db.delete(attachments).where(eq(attachments.id, id)).run();
  return result.changes > 0;
}

export function countAttachments(db: DB, taskId: string) {
  const row = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(attachments)
    .where(eq(attachments.task_id, taskId))
    .get();

  return row?.count ?? 0;
}
