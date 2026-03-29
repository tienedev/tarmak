import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type DB,
  boardsRepo,
  columnsRepo,
  tasksRepo,
  labelsRepo,
  subtasksRepo,
  searchRepo,
  archiveRepo,
} from "@tarmak/db";
import { Schema, encodeFull, rowFromMap } from "@tarmak/kbf";

const TASK_SCHEMA = new Schema(
  "task",
  ["id", "col", "title", "desc", "pri", "who", "pos", "due", "labels", "subtasks"],
  2,
);

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

interface TaskRow {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: string;
  assignee: string | null;
  position: number;
  due_date: string | null;
  board_id: string;
  archived: boolean;
}

function formatTaskText(task: TaskRow): string {
  const parts = [`- ${task.title}`];
  if (task.assignee) parts.push(`(${task.assignee}`);
  if (task.due_date) {
    if (task.assignee) parts.push(`, due: ${task.due_date})`);
    else parts.push(`(due: ${task.due_date})`);
  } else if (task.assignee) {
    parts.push(")");
  }
  return parts.join("");
}

function formatTasksForOutput(
  db: DB,
  tasks: TaskRow[],
  format: string,
): string {
  if (tasks.length === 0) return "No matching tasks found.";

  switch (format) {
    case "json":
      return JSON.stringify(tasks, null, 2);
    case "kbf": {
      const rows = tasks.map((t) => {
        const labelNames = getTaskLabelNames(db, t.id);
        const subtaskStr = getSubtaskString(db, t.id);
        const map = new Map<string, string>();
        map.set("id", t.id);
        map.set("col", t.column_id);
        map.set("title", t.title);
        map.set("desc", t.description ?? "");
        map.set("pri", t.priority);
        map.set("who", t.assignee ?? "");
        map.set("pos", String(t.position));
        map.set("due", t.due_date ?? "");
        map.set("labels", labelNames.join(","));
        map.set("subtasks", subtaskStr);
        return rowFromMap(TASK_SCHEMA, map);
      });
      return encodeFull(TASK_SCHEMA, rows);
    }
    default: // text
      return tasks.map(formatTaskText).join("\n");
  }
}

function isOverdue(dueDate: string): boolean {
  const now = new Date();
  const due = new Date(dueDate);
  return due < now;
}

function isDueSoon(dueDate: string, days: number = 3): boolean {
  const now = new Date();
  const due = new Date(dueDate);
  const limit = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return due >= now && due <= limit;
}

function isDueToday(dueDate: string): boolean {
  const now = new Date();
  const due = new Date(dueDate);
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

function isStale(updatedAt: string, days: number = 7): boolean {
  const updated = new Date(updatedAt);
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return updated < threshold;
}

export function registerBoardAskTool(server: McpServer, db: DB) {
  server.tool(
    "board_ask",
    "Ask natural language questions about board",
    {
      board_id: z.string().describe("Board UUID"),
      question: z.string().describe("Natural language question"),
      format: z.enum(["text", "json", "kbf"]).default("text").describe("Response format"),
    },
    async (args) => {
      const { board_id, question, format } = args;

      const board = boardsRepo.getBoard(db, board_id);
      if (!board) {
        return text(`Error: board ${board_id} not found`);
      }

      const q = question.toLowerCase();
      const allTasks = tasksRepo.listTasks(db, board_id);

      // Pattern: overdue
      if (q.includes("overdue")) {
        const overdue = allTasks.filter((t) => t.due_date && isOverdue(t.due_date));
        return text(formatTasksForOutput(db, overdue, format));
      }

      // Pattern: due soon / due today
      if (q.includes("due soon") || q.includes("due today")) {
        const isDueCheck = q.includes("due today") ? isDueToday : (d: string) => isDueSoon(d, 3);
        const matching = allTasks.filter((t) => t.due_date && isDueCheck(t.due_date));
        return text(formatTasksForOutput(db, matching, format));
      }

      // Pattern: unassigned
      if (q.includes("unassigned")) {
        const unassigned = allTasks.filter((t) => !t.assignee);
        return text(formatTasksForOutput(db, unassigned, format));
      }

      // Pattern: no labels
      if (q.includes("no label")) {
        const noLabels = allTasks.filter((t) => {
          const labels = labelsRepo.getTaskLabels(db, t.id);
          return labels.length === 0;
        });
        return text(formatTasksForOutput(db, noLabels, format));
      }

      // Pattern: stale / blocked
      if (q.includes("stale") || q.includes("blocked")) {
        const stale = allTasks.filter((t) => isStale(t.updated_at, 7));
        return text(formatTasksForOutput(db, stale, format));
      }

      // Pattern: stats / statistics / summary
      if (q.includes("stats") || q.includes("statistics") || q.includes("summary")) {
        const cols = columnsRepo.listColumns(db, board_id);
        const colCounts = cols.map((c) => {
          const count = allTasks.filter((t) => t.column_id === c.id).length;
          return `  ${c.name}: ${count}`;
        });

        const priorities: Record<string, number> = {};
        for (const t of allTasks) {
          priorities[t.priority] = (priorities[t.priority] ?? 0) + 1;
        }
        const priLines = Object.entries(priorities)
          .sort()
          .map(([p, c]) => `  ${p}: ${c}`);

        const assigned = allTasks.filter((t) => t.assignee).length;
        const overdue = allTasks.filter((t) => t.due_date && isOverdue(t.due_date)).length;

        const statsText = [
          `Board: ${board.name}`,
          `Total tasks: ${allTasks.length}`,
          `By column:`,
          ...colCounts,
          `By priority:`,
          ...priLines,
          `Assigned: ${assigned}`,
          `Overdue: ${overdue}`,
        ].join("\n");

        if (format === "json") {
          return text(
            JSON.stringify(
              {
                name: board.name,
                total_tasks: allTasks.length,
                by_column: Object.fromEntries(
                  cols.map((c) => [c.name, allTasks.filter((t) => t.column_id === c.id).length]),
                ),
                by_priority: priorities,
                assigned,
                overdue,
              },
              null,
              2,
            ),
          );
        }
        return text(statsText);
      }

      // Pattern: high priority
      if (q.includes("high priority") || q.includes("urgent")) {
        const highPri = allTasks.filter(
          (t) => t.priority === "high" || t.priority === "urgent",
        );
        return text(formatTasksForOutput(db, highPri, format));
      }

      // Pattern: no due date
      if (q.includes("no due date") || q.includes("no due")) {
        const noDue = allTasks.filter((t) => !t.due_date);
        return text(formatTasksForOutput(db, noDue, format));
      }

      // Pattern: archived
      if (q.includes("archived")) {
        const archived = archiveRepo.listArchivedTasks(db, board_id);
        return text(formatTasksForOutput(db, archived, format));
      }

      // Fallback: FTS5 search
      try {
        const results = searchRepo.search(db, board_id, question);
        if (results.length > 0) {
          if (format === "json") {
            return text(JSON.stringify(results, null, 2));
          }
          const lines = results.map(
            (r) => `- [${r.entity_type}] ${r.snippet} (${r.entity_id})`,
          );
          return text(lines.join("\n"));
        }
      } catch {
        // FTS5 query syntax error — fall through
      }

      return text("No results found. Try a more specific question.");
    },
  );
}
