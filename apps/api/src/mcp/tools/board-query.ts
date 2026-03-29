import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type DB,
  boardsRepo,
  columnsRepo,
  tasksRepo,
  labelsRepo,
  subtasksRepo,
  attachmentsRepo,
  searchRepo,
} from "@tarmak/db";
import { Schema, encodeFull, rowFromMap } from "@tarmak/kbf";

const TASK_SCHEMA = new Schema(
  "task",
  ["id", "col", "title", "desc", "pri", "who", "pos", "due", "labels", "subtasks"],
  2,
);
const COLUMN_SCHEMA = new Schema("column", ["id", "name", "pos", "wip", "color"], 1);
const LABEL_SCHEMA = new Schema("label", ["id", "name", "color"], 1);

function taskToRow(
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
  labelNames: string[],
  subtaskStr: string,
) {
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

function getTaskLabelNames(db: DB, taskId: string): string[] {
  const labels = labelsRepo.getTaskLabels(db, taskId);
  return labels.map((l) => l.name);
}

function getSubtaskString(db: DB, taskId: string): string {
  const subs = subtasksRepo.listSubtasks(db, taskId);
  const done = subs.filter((s) => s.completed).length;
  return `${done}/${subs.length}`;
}

function formatTasksKbf(db: DB, boardId: string): string {
  const allTasks = tasksRepo.listTasks(db, boardId);
  const rows = allTasks.map((t) => {
    const labelNames = getTaskLabelNames(db, t.id);
    const subtaskStr = getSubtaskString(db, t.id);
    return taskToRow(t, labelNames, subtaskStr);
  });
  return encodeFull(TASK_SCHEMA, rows);
}

function formatColumnsKbf(db: DB, boardId: string): string {
  const cols = columnsRepo.listColumns(db, boardId);
  const rows = cols.map(columnToRow);
  return encodeFull(COLUMN_SCHEMA, rows);
}

function formatLabelsKbf(db: DB, boardId: string): string {
  const lbls = labelsRepo.listLabels(db, boardId);
  const rows = lbls.map(labelToRow);
  return encodeFull(LABEL_SCHEMA, rows);
}

function formatTasksJson(db: DB, boardId: string): string {
  const allTasks = tasksRepo.listTasks(db, boardId);
  return JSON.stringify(allTasks, null, 2);
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

export function registerBoardQueryTool(server: McpServer, db: DB) {
  server.tool(
    "board_query",
    "Query kanban board state",
    {
      board_id: z.string().describe("Board UUID or 'list' to list all boards"),
      scope: z
        .enum(["info", "tasks", "columns", "labels", "subtasks", "search", "attachments", "all"])
        .default("all")
        .describe("What to query"),
      format: z.enum(["kbf", "json"]).default("kbf").describe("Output format"),
      task_id: z.string().optional().describe("Task ID for subtasks/attachments scope"),
      query: z.string().optional().describe("Search query for search scope"),
    },
    async (args) => {
      const { board_id, scope, format, task_id, query } = args;

      // List all boards
      if (board_id === "list") {
        const boards = boardsRepo.listBoards(db);
        return text(JSON.stringify(boards, null, 2));
      }

      // Validate board exists
      const board = boardsRepo.getBoard(db, board_id);
      if (!board) {
        return text(`Error: board ${board_id} not found`);
      }

      switch (scope) {
        case "info":
          return text(JSON.stringify(board, null, 2));

        case "tasks":
          if (format === "kbf") {
            return text(formatTasksKbf(db, board_id));
          }
          return text(formatTasksJson(db, board_id));

        case "columns":
          if (format === "kbf") {
            return text(formatColumnsKbf(db, board_id));
          }
          return text(JSON.stringify(columnsRepo.listColumns(db, board_id), null, 2));

        case "labels":
          if (format === "kbf") {
            return text(formatLabelsKbf(db, board_id));
          }
          return text(JSON.stringify(labelsRepo.listLabels(db, board_id), null, 2));

        case "subtasks": {
          if (!task_id) {
            return text("Error: task_id required for subtasks scope");
          }
          const subs = subtasksRepo.listSubtasks(db, task_id);
          return text(JSON.stringify(subs, null, 2));
        }

        case "search": {
          if (!query) {
            return text("Error: query required for search scope");
          }
          const results = searchRepo.search(db, board_id, query);
          return text(JSON.stringify(results, null, 2));
        }

        case "attachments": {
          if (!task_id) {
            return text("Error: task_id required for attachments scope");
          }
          const atts = attachmentsRepo.listAttachments(db, task_id);
          return text(JSON.stringify(atts, null, 2));
        }

        case "all": {
          if (format === "kbf") {
            const info = JSON.stringify(board, null, 2);
            const cols = formatColumnsKbf(db, board_id);
            const tks = formatTasksKbf(db, board_id);
            const lbls = formatLabelsKbf(db, board_id);
            return text([info, "", cols, "", tks, "", lbls].join("\n"));
          }
          const cols = columnsRepo.listColumns(db, board_id);
          const tks = tasksRepo.listTasks(db, board_id);
          const lbls = labelsRepo.listLabels(db, board_id);
          return text(
            JSON.stringify({ board, columns: cols, tasks: tks, labels: lbls }, null, 2),
          );
        }
      }
    },
  );
}
