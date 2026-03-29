import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type DB, boardsRepo, tasksRepo } from "@tarmak/db";
import { decodeDeltas } from "@tarmak/kbf";
import type { Delta } from "@tarmak/kbf";
import { text, formatFullBoardKbf } from "../shared";

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

function applyDelta(db: DB, boardId: string, delta: Delta): string {
  switch (delta.type) {
    case "update": {
      const dbField = TASK_FIELD_MAP[delta.field];
      if (!dbField) {
        if (delta.field === "labels") {
          return `skipped labels update for ${delta.id}`;
        }
        return `unknown field: ${delta.field}`;
      }
      if (dbField === "column_id") {
        const task = tasksRepo.getTask(db, delta.id);
        if (!task) return `task ${delta.id} not found`;
        tasksRepo.moveTask(db, delta.id, delta.value, task.position);
      } else if (dbField === "position") {
        const pos = parseInt(delta.value, 10);
        if (Number.isNaN(pos)) return `invalid position: ${delta.value}`;
        const task = tasksRepo.getTask(db, delta.id);
        if (!task) return `task ${delta.id} not found`;
        tasksRepo.moveTask(db, delta.id, task.column_id, pos);
      } else {
        const updateData: Record<string, string> = {};
        updateData[dbField] = delta.value;
        tasksRepo.updateTask(db, delta.id, updateData);
      }
      return `updated ${delta.id}.${delta.field}`;
    }
    case "create": {
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

      return text(formatFullBoardKbf(db, board_id));
    },
  );
}
