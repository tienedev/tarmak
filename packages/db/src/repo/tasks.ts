import { eq, and, sql, isNull, asc } from "drizzle-orm";
import type { DB } from "../connection";
import {
  tasks,
  labels,
  taskLabels,
  subtasks,
  attachments,
  taskCustomFieldValues,
} from "../schema/index";

export function createTask(
  db: DB,
  opts: {
    boardId: string;
    columnId: string;
    title: string;
    description?: string;
    priority?: string;
    assignee?: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Auto-position: MAX(position) + 1 in column
  const maxRow = db
    .select({ max: sql<number>`COALESCE(MAX(${tasks.position}), 0)` })
    .from(tasks)
    .where(eq(tasks.column_id, opts.columnId))
    .get();
  const position = (maxRow?.max ?? 0) + 1;

  db.insert(tasks)
    .values({
      id,
      board_id: opts.boardId,
      column_id: opts.columnId,
      title: opts.title,
      description: opts.description ?? null,
      priority: opts.priority ?? "medium",
      assignee: opts.assignee ?? null,
      position,
      created_at: now,
      updated_at: now,
      archived: false,
    })
    .run();

  return db.select().from(tasks).where(eq(tasks.id, id)).get()!;
}

export function getTask(db: DB, id: string) {
  return db.select().from(tasks).where(eq(tasks.id, id)).get() ?? null;
}

export function getTaskWithRelations(db: DB, id: string) {
  const task = getTask(db, id);
  if (!task) return null;

  // Get labels via task_labels JOIN labels
  const taskLabelRows = db
    .select({ label: labels })
    .from(taskLabels)
    .innerJoin(labels, eq(taskLabels.label_id, labels.id))
    .where(eq(taskLabels.task_id, id))
    .all();
  const labelList = taskLabelRows.map((r) => r.label);

  // Get subtask counts
  const subtaskRows = db
    .select()
    .from(subtasks)
    .where(eq(subtasks.task_id, id))
    .all();
  const total = subtaskRows.length;
  const completed = subtaskRows.filter((s) => s.completed).length;

  // Get attachment count
  const attachmentCount = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(attachments)
    .where(eq(attachments.task_id, id))
    .get();

  return {
    ...task,
    labels: labelList,
    subtask_count: { completed, total },
    attachment_count: attachmentCount?.count ?? 0,
  };
}

export function listTasks(db: DB, boardId: string, limit?: number, offset?: number) {
  let query = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.board_id, boardId), eq(tasks.archived, false)))
    .orderBy(asc(tasks.position))
    .$dynamic();

  if (limit !== undefined) {
    query = query.limit(limit);
  }
  if (offset !== undefined) {
    query = query.offset(offset);
  }

  return query.all();
}

export function updateTask(
  db: DB,
  id: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
    assignee?: string;
    due_date?: string;
  },
) {
  const existing = getTask(db, id);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.assignee !== undefined) updates.assignee = data.assignee;
  if (data.due_date !== undefined) updates.due_date = data.due_date;

  db.update(tasks).set(updates).where(eq(tasks.id, id)).run();

  return db.select().from(tasks).where(eq(tasks.id, id)).get()!;
}

export function deleteTask(db: DB, id: string) {
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  return result.changes > 0;
}

export function moveTask(db: DB, id: string, columnId: string, position: number) {
  const existing = getTask(db, id);
  if (!existing) return null;

  db.update(tasks)
    .set({ column_id: columnId, position, updated_at: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();

  return db.select().from(tasks).where(eq(tasks.id, id)).get()!;
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function claimTask(db: DB, boardId: string, agentId: string) {
  // Find all unlocked ai-ready tasks for this board
  const candidates = db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(taskLabels, eq(tasks.id, taskLabels.task_id))
    .innerJoin(labels, eq(taskLabels.label_id, labels.id))
    .where(
      and(
        eq(tasks.board_id, boardId),
        eq(labels.name, "ai-ready"),
        isNull(tasks.locked_by),
        eq(tasks.archived, false),
      ),
    )
    .all();

  if (candidates.length === 0) return null;

  // Sort by priority order (urgent > high > medium > low), then by due_date ASC (nulls last)
  candidates.sort((a, b) => {
    const prioA = PRIORITY_ORDER[a.task.priority] ?? 2;
    const prioB = PRIORITY_ORDER[b.task.priority] ?? 2;
    if (prioA !== prioB) return prioA - prioB;

    // due_date ASC, nulls last
    if (a.task.due_date && b.task.due_date) return a.task.due_date.localeCompare(b.task.due_date);
    if (a.task.due_date && !b.task.due_date) return -1;
    if (!a.task.due_date && b.task.due_date) return 1;
    return 0;
  });

  // Try to atomically lock the best candidate
  for (const candidate of candidates) {
    const result = db.run(
      sql`UPDATE tasks SET locked_by = ${agentId}, locked_at = datetime('now') WHERE id = ${candidate.task.id} AND locked_by IS NULL`,
    );

    if (result.changes > 0) {
      // Successfully locked — fetch the updated task
      const lockedTask = db.select().from(tasks).where(eq(tasks.id, candidate.task.id)).get()!;

      // Get all label names for this task
      const taskLabelNames = db
        .select({ name: labels.name })
        .from(taskLabels)
        .innerJoin(labels, eq(taskLabels.label_id, labels.id))
        .where(eq(taskLabels.task_id, lockedTask.id))
        .all()
        .map((r) => r.name);

      return { task: lockedTask, labels: taskLabelNames };
    }
  }

  return null;
}

export function releaseTask(db: DB, taskId: string) {
  db.update(tasks)
    .set({ locked_by: null, locked_at: null })
    .where(eq(tasks.id, taskId))
    .run();
}

export function duplicateTask(db: DB, taskId: string, boardId: string) {
  return db.transaction((tx) => {
    const original = tx.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!original) throw new Error(`Task ${taskId} not found`);

    const newPosition = original.position + 1;

    // Shift subsequent task positions +1
    tx.run(
      sql`UPDATE tasks SET position = position + 1 WHERE column_id = ${original.column_id} AND position > ${original.position}`,
    );

    // Create the copy
    const newTaskId = crypto.randomUUID();
    const now = new Date().toISOString();

    tx.insert(tasks)
      .values({
        id: newTaskId,
        board_id: boardId,
        column_id: original.column_id,
        title: `Copy of ${original.title}`,
        description: original.description,
        priority: original.priority,
        assignee: null, // Do NOT copy assignee
        position: newPosition,
        created_at: now,
        updated_at: now,
        due_date: null, // Do NOT copy due_date
        archived: false,
      })
      .run();

    // Copy task_labels
    const originalLabels = tx
      .select()
      .from(taskLabels)
      .where(eq(taskLabels.task_id, taskId))
      .all();
    for (const tl of originalLabels) {
      tx.insert(taskLabels).values({ task_id: newTaskId, label_id: tl.label_id }).run();
    }

    // Copy subtasks (completed=false)
    const originalSubtasks = tx
      .select()
      .from(subtasks)
      .where(eq(subtasks.task_id, taskId))
      .all();
    for (const st of originalSubtasks) {
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

    // Copy task_custom_field_values
    const originalValues = tx
      .select()
      .from(taskCustomFieldValues)
      .where(eq(taskCustomFieldValues.task_id, taskId))
      .all();
    for (const v of originalValues) {
      tx.insert(taskCustomFieldValues)
        .values({ task_id: newTaskId, field_id: v.field_id, value: v.value })
        .run();
    }

    // Return as TaskWithRelations
    const newTask = tx.select().from(tasks).where(eq(tasks.id, newTaskId)).get()!;

    const newLabels = tx
      .select({ label: labels })
      .from(taskLabels)
      .innerJoin(labels, eq(taskLabels.label_id, labels.id))
      .where(eq(taskLabels.task_id, newTaskId))
      .all()
      .map((r) => r.label);

    const newSubtasks = tx
      .select()
      .from(subtasks)
      .where(eq(subtasks.task_id, newTaskId))
      .all();

    const attachmentCount = tx
      .select({ count: sql<number>`COUNT(*)` })
      .from(attachments)
      .where(eq(attachments.task_id, newTaskId))
      .get();

    return {
      ...newTask,
      labels: newLabels,
      subtask_count: {
        completed: newSubtasks.filter((s) => s.completed).length,
        total: newSubtasks.length,
      },
      attachment_count: attachmentCount?.count ?? 0,
    };
  });
}
