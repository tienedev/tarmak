import { eq, sql, and } from "drizzle-orm";
import type { DB } from "../connection";
import {
  boards,
  columns,
  labels,
  taskLabels,
  customFields,
  taskCustomFieldValues,
  tasks,
  subtasks,
  boardMembers,
  users,
} from "../schema/index";

export function createBoard(db: DB, name: string, description?: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(boards)
    .values({ id, name, description: description ?? null, created_at: now, updated_at: now })
    .run();

  return db.select().from(boards).where(eq(boards.id, id)).get()!;
}

export function getBoard(db: DB, id: string) {
  return db.select().from(boards).where(eq(boards.id, id)).get() ?? null;
}

export function listBoards(db: DB) {
  return db.select().from(boards).orderBy(boards.created_at).all();
}

export function updateBoard(
  db: DB,
  id: string,
  data: { name?: string; description?: string; repo_url?: string },
) {
  const existing = getBoard(db, id);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.repo_url !== undefined) updates.repo_url = data.repo_url;

  db.update(boards).set(updates).where(eq(boards.id, id)).run();

  return db.select().from(boards).where(eq(boards.id, id)).get()!;
}

export function deleteBoard(db: DB, id: string) {
  const result = db.delete(boards).where(eq(boards.id, id)).run();
  return result.changes > 0;
}

export function duplicateBoard(
  db: DB,
  boardId: string,
  newName: string,
  includeTasks: boolean,
  ownerId: string,
) {
  return db.transaction((tx) => {
    const original = tx.select().from(boards).where(eq(boards.id, boardId)).get();
    if (!original) throw new Error(`Board ${boardId} not found`);

    // Create new board
    const newBoardId = crypto.randomUUID();
    const now = new Date().toISOString();
    tx.insert(boards)
      .values({
        id: newBoardId,
        name: newName,
        description: original.description,
        repo_url: original.repo_url,
        created_at: now,
        updated_at: now,
      })
      .run();

    // Copy non-archived columns
    const oldColumns = tx
      .select()
      .from(columns)
      .where(and(eq(columns.board_id, boardId), eq(columns.archived, false)))
      .all();

    const columnMap = new Map<string, string>();
    for (const col of oldColumns) {
      const newColId = crypto.randomUUID();
      columnMap.set(col.id, newColId);
      tx.insert(columns)
        .values({
          id: newColId,
          board_id: newBoardId,
          name: col.name,
          position: col.position,
          wip_limit: col.wip_limit,
          color: col.color,
          archived: false,
        })
        .run();
    }

    // Copy labels
    const oldLabels = tx.select().from(labels).where(eq(labels.board_id, boardId)).all();
    const labelMap = new Map<string, string>();
    for (const label of oldLabels) {
      const newLabelId = crypto.randomUUID();
      labelMap.set(label.id, newLabelId);
      tx.insert(labels)
        .values({
          id: newLabelId,
          board_id: newBoardId,
          name: label.name,
          color: label.color,
        })
        .run();
    }

    // Copy custom fields
    const oldFields = tx.select().from(customFields).where(eq(customFields.board_id, boardId)).all();
    const fieldMap = new Map<string, string>();
    for (const field of oldFields) {
      const newFieldId = crypto.randomUUID();
      fieldMap.set(field.id, newFieldId);
      tx.insert(customFields)
        .values({
          id: newFieldId,
          board_id: newBoardId,
          name: field.name,
          field_type: field.field_type,
          config: field.config,
          position: field.position,
        })
        .run();
    }

    // Copy tasks if requested
    if (includeTasks) {
      const oldTasks = tx.select().from(tasks).where(eq(tasks.board_id, boardId)).all();

      for (const task of oldTasks) {
        const newColumnId = columnMap.get(task.column_id);
        if (!newColumnId) continue; // Skip tasks in archived columns

        const newTaskId = crypto.randomUUID();

        tx.insert(tasks)
          .values({
            id: newTaskId,
            board_id: newBoardId,
            column_id: newColumnId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            assignee: task.assignee,
            position: task.position,
            created_at: now,
            updated_at: now,
            due_date: task.due_date,
            archived: task.archived,
          })
          .run();

        // Copy task_labels with remapped label_ids
        const oldTaskLabels = tx
          .select()
          .from(taskLabels)
          .where(eq(taskLabels.task_id, task.id))
          .all();
        for (const tl of oldTaskLabels) {
          const newLabelId = labelMap.get(tl.label_id);
          if (newLabelId) {
            tx.insert(taskLabels).values({ task_id: newTaskId, label_id: newLabelId }).run();
          }
        }

        // Copy subtasks (reset completed=false)
        const oldSubtasks = tx.select().from(subtasks).where(eq(subtasks.task_id, task.id)).all();
        for (const st of oldSubtasks) {
          tx.insert(subtasks)
            .values({
              id: crypto.randomUUID(),
              task_id: newTaskId,
              title: st.title,
              completed: false,
              position: st.position,
            })
            .run();
        }

        // Copy task_custom_field_values with remapped field_ids
        const oldValues = tx
          .select()
          .from(taskCustomFieldValues)
          .where(eq(taskCustomFieldValues.task_id, task.id))
          .all();
        for (const v of oldValues) {
          const newFieldId = fieldMap.get(v.field_id);
          if (newFieldId) {
            tx.insert(taskCustomFieldValues)
              .values({ task_id: newTaskId, field_id: newFieldId, value: v.value })
              .run();
          }
        }
      }
    }

    // Add owner as member
    tx.insert(boardMembers)
      .values({ board_id: newBoardId, user_id: ownerId, role: "owner" })
      .run();

    return tx.select().from(boards).where(eq(boards.id, newBoardId)).get()!;
  });
}

export function addMember(db: DB, boardId: string, userId: string, role: string) {
  db.run(
    sql`INSERT OR REPLACE INTO board_members (board_id, user_id, role) VALUES (${boardId}, ${userId}, ${role})`,
  );
}

export function removeMember(db: DB, boardId: string, userId: string) {
  const result = db
    .delete(boardMembers)
    .where(and(eq(boardMembers.board_id, boardId), eq(boardMembers.user_id, userId)))
    .run();
  return result.changes > 0;
}

export function listMembers(db: DB, boardId: string) {
  const rows = db
    .select({
      user: users,
      role: boardMembers.role,
    })
    .from(boardMembers)
    .innerJoin(users, eq(boardMembers.user_id, users.id))
    .where(eq(boardMembers.board_id, boardId))
    .orderBy(users.name)
    .all();

  return rows;
}

export function getMemberRole(db: DB, boardId: string, userId: string) {
  const row = db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.board_id, boardId), eq(boardMembers.user_id, userId)))
    .get();

  return row?.role ?? null;
}
