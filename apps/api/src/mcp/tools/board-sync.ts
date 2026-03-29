import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type DB,
  boardsRepo,
  columnsRepo,
  tasksRepo,
  labelsRepo,
  subtasksRepo,
} from "@tarmak/db";
import { Schema, encodeFull, decodeDeltas, rowFromMap } from "@tarmak/kbf";
import type { Delta } from "@tarmak/kbf";

const TASK_SCHEMA = new Schema(
  "task",
  ["id", "col", "title", "desc", "pri", "who", "pos", "due", "labels", "subtasks"],
  2,
);
const COLUMN_SCHEMA = new Schema("column", ["id", "name", "pos", "wip", "color"], 1);
const LABEL_SCHEMA = new Schema("label", ["id", "name", "color"], 1);

// Maps KBF field names to DB field names for update deltas
const TASK_FIELD_MAP: Record<string, string> = {
  title: "title",
  desc: "description",
  pri: "priority",
  who: "assignee",
  pos: "position",
  due: "due_date",
  col: "column_id",
};

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function getTaskLabelNames(db: DB, taskId: string): string[] {
  const labels = labelsRepo.getTaskLabels(db, taskId);
  return labels.map((l) => l.name);
}

function getSubtaskString(db: DB, taskId: string): string {
  const subs = subtasksRepo.listSubtasks(db, taskId);
  const done = subs.filter((s) => s.completed).length;
  return `${done}/${subs.length}`;
}

function taskToRow(
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

function columnToRow(col: {
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

function labelToRow(label: { id: string; name: string; color: string }) {
  const map = new Map<string, string>();
  map.set("id", label.id);
  map.set("name", label.name);
  map.set("color", label.color);
  return rowFromMap(LABEL_SCHEMA, map);
}

function formatFullBoardKbf(db: DB, boardId: string): string {
  const board = boardsRepo.getBoard(db, boardId);
  const info = JSON.stringify(board, null, 2);

  const cols = columnsRepo.listColumns(db, boardId);
  const colRows = cols.map(columnToRow);
  const colsKbf = encodeFull(COLUMN_SCHEMA, colRows);

  const allTasks = tasksRepo.listTasks(db, boardId);
  const taskRows = allTasks.map((t) => taskToRow(db, t));
  const tasksKbf = encodeFull(TASK_SCHEMA, taskRows);

  const lbls = labelsRepo.listLabels(db, boardId);
  const labelRows = lbls.map(labelToRow);
  const labelsKbf = encodeFull(LABEL_SCHEMA, labelRows);

  return [info, "", colsKbf, "", tasksKbf, "", labelsKbf].join("\n");
}

function applyDelta(db: DB, boardId: string, delta: Delta): string {
  switch (delta.type) {
    case "update": {
      const dbField = TASK_FIELD_MAP[delta.field];
      if (!dbField) {
        // Handle labels specially
        if (delta.field === "labels") {
          // Labels update not supported via delta — ignore
          return `skipped labels update for ${delta.id}`;
        }
        return `unknown field: ${delta.field}`;
      }
      if (dbField === "column_id") {
        // Move task to a different column, keep current position
        const task = tasksRepo.getTask(db, delta.id);
        if (!task) return `task ${delta.id} not found`;
        tasksRepo.moveTask(db, delta.id, delta.value, task.position);
      } else if (dbField === "position") {
        const task = tasksRepo.getTask(db, delta.id);
        if (!task) return `task ${delta.id} not found`;
        tasksRepo.moveTask(db, delta.id, task.column_id, parseInt(delta.value, 10));
      } else {
        const updateData: Record<string, string> = {};
        updateData[dbField] = delta.value;
        tasksRepo.updateTask(db, delta.id, updateData);
      }
      return `updated ${delta.id}.${delta.field}`;
    }
    case "create": {
      // row format: colid|title|desc|pri|who|pos
      const row = delta.row;
      if (row.length < 2) return "error: create delta needs at least colid|title";
      const task = tasksRepo.createTask(db, {
        boardId,
        columnId: row[0],
        title: row[1],
        description: row[2] || undefined,
        priority: row[3] || undefined,
        assignee: row[4] || undefined,
      });
      return `created task ${task.id}`;
    }
    case "delete": {
      const ok = tasksRepo.deleteTask(db, delta.id);
      return ok ? `deleted ${delta.id}` : `task ${delta.id} not found`;
    }
  }
}

export function registerBoardSyncTool(server: McpServer, db: DB) {
  server.tool(
    "board_sync",
    "Sync board state via KBF deltas",
    {
      board_id: z.string().describe("Board UUID"),
      delta: z.string().optional().describe("KBF delta string"),
    },
    async (args) => {
      const { board_id, delta } = args;

      const board = boardsRepo.getBoard(db, board_id);
      if (!board) {
        return text(`Error: board ${board_id} not found`);
      }

      // Apply deltas if provided
      if (delta) {
        try {
          const deltas = decodeDeltas(delta);
          const results: string[] = [];
          for (const d of deltas) {
            results.push(applyDelta(db, board_id, d));
          }
          const applied = results.join("; ");
          const fullState = formatFullBoardKbf(db, board_id);
          return text(`Applied: ${applied}\n\n${fullState}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return text(`Error parsing delta: ${msg}`);
        }
      }

      // No delta — just return current state
      return text(formatFullBoardKbf(db, board_id));
    },
  );
}
