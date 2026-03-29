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
import {
  text,
  formatTasksKbf,
  formatColumnsKbf,
  formatLabelsKbf,
} from "../shared";

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
          return text(JSON.stringify(tasksRepo.listTasks(db, board_id), null, 2));

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
