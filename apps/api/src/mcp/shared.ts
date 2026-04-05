import type { DB } from "@tarmak/db";
import { labelsRepo, subtasksRepo, columnsRepo, tasksRepo, boardsRepo } from "@tarmak/db";
import { Schema, encodeFull, rowFromMap } from "@tarmak/kbf";

export const TASK_SCHEMA = new Schema(
  "task",
  ["id", "col", "title", "desc", "pri", "who", "pos", "due", "labels", "subtasks"],
  2,
);
export const COLUMN_SCHEMA = new Schema("column", ["id", "name", "pos", "wip", "color"], 1);
export const LABEL_SCHEMA = new Schema("label", ["id", "name", "color"], 1);

export function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

export function getTaskLabelNames(db: DB, taskId: string): string[] {
  const labels = labelsRepo.getTaskLabels(db, taskId);
  return labels.map((l) => l.name);
}

export function getSubtaskString(db: DB, taskId: string): string {
  const subs = subtasksRepo.listSubtasks(db, taskId);
  const done = subs.filter((s) => s.completed).length;
  return `${done}/${subs.length}`;
}

export function taskToRow(
  db: DB,
  task: {
    id: string;
    column_id: string;
    title: string;
    description: string | null;
    priority: string;
    assignee: string | null;
    position: number;
    due_date: string | null;
  },
) {
  const labelNames = getTaskLabelNames(db, task.id);
  const subtaskStr = getSubtaskString(db, task.id);
  const map = new Map<string, string>();
  map.set("id", task.id);
  map.set("col", task.column_id);
  map.set("title", task.title);
  map.set("desc", task.description ?? "");
  map.set("pri", task.priority);
  map.set("who", task.assignee ?? "");
  map.set("pos", String(task.position));
  map.set("due", task.due_date ?? "");
  map.set("labels", labelNames.join(","));
  map.set("subtasks", subtaskStr);
  return rowFromMap(TASK_SCHEMA, map);
}

export function columnToRow(col: {
  id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  color: string | null;
}) {
  const map = new Map<string, string>();
  map.set("id", col.id);
  map.set("name", col.name);
  map.set("pos", String(col.position));
  map.set("wip", col.wip_limit != null ? String(col.wip_limit) : "");
  map.set("color", col.color ?? "");
  return rowFromMap(COLUMN_SCHEMA, map);
}

export function labelToRow(label: { id: string; name: string; color: string }) {
  const map = new Map<string, string>();
  map.set("id", label.id);
  map.set("name", label.name);
  map.set("color", label.color);
  return rowFromMap(LABEL_SCHEMA, map);
}

export function formatTasksKbf(db: DB, boardId: string): string {
  const allTasks = tasksRepo.listTasks(db, boardId);
  const rows = allTasks.map((t) => taskToRow(db, t));
  return encodeFull(TASK_SCHEMA, rows);
}

export function formatColumnsKbf(db: DB, boardId: string): string {
  const cols = columnsRepo.listColumns(db, boardId);
  const rows = cols.map(columnToRow);
  return encodeFull(COLUMN_SCHEMA, rows);
}

export function formatLabelsKbf(db: DB, boardId: string): string {
  const lbls = labelsRepo.listLabels(db, boardId);
  const rows = lbls.map(labelToRow);
  return encodeFull(LABEL_SCHEMA, rows);
}

export function formatFullBoardKbf(db: DB, boardId: string): string {
  const board = boardsRepo.getBoard(db, boardId);
  const info = JSON.stringify(board, null, 2);
  const colsKbf = formatColumnsKbf(db, boardId);
  const tasksKbf = formatTasksKbf(db, boardId);
  const labelsKbf = formatLabelsKbf(db, boardId);
  return [info, "", colsKbf, "", tasksKbf, "", labelsKbf].join("\n");
}
