import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type DB,
  archiveRepo,
  attachmentsRepo,
  boardsRepo,
  columnsRepo,
  commentsRepo,
  customFieldsRepo,
  labelsRepo,
  subtasksRepo,
  tasksRepo,
} from "@tarmak/db";
import { z } from "zod";
import { text } from "../shared";

type MutateData = Record<string, unknown>;

function str(data: MutateData, key: string): string {
  const v = data[key];
  if (typeof v !== "string") throw new Error(`missing or invalid field: ${key}`);
  return v;
}

function optStr(data: MutateData, key: string): string | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`invalid field: ${key}`);
  return v;
}

function optNum(data: MutateData, key: string): number | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number") throw new Error(`invalid field: ${key}`);
  return v;
}

function num(data: MutateData, key: string): number {
  const v = data[key];
  if (typeof v !== "number") throw new Error(`missing or invalid field: ${key}`);
  return v;
}

function bool(data: MutateData, key: string, defaultValue: boolean): boolean {
  const v = data[key];
  if (v === undefined || v === null) return defaultValue;
  if (typeof v !== "boolean") throw new Error(`invalid field: ${key}`);
  return v;
}

function handleMutate(db: DB, boardId: string, action: string, data: MutateData): string {
  switch (action) {
    // ---- Task ----
    case "create_task": {
      const task = tasksRepo.createTask(db, {
        boardId,
        columnId: str(data, "column_id"),
        title: str(data, "title"),
        description: optStr(data, "description"),
        priority: optStr(data, "priority"),
        assignee: optStr(data, "assignee"),
      });
      return `created task ${task.id}`;
    }
    case "update_task": {
      const result = tasksRepo.updateTask(db, str(data, "task_id"), {
        title: optStr(data, "title"),
        description: optStr(data, "description"),
        priority: optStr(data, "priority"),
        assignee: optStr(data, "assignee"),
        due_date: optStr(data, "due_date"),
      });
      if (!result) return "error: task not found";
      return `updated task ${result.id}`;
    }
    case "move_task": {
      const result = tasksRepo.moveTask(
        db,
        str(data, "task_id"),
        str(data, "column_id"),
        num(data, "position"),
      );
      if (!result) return "error: task not found";
      return `moved task ${result.id}`;
    }
    case "delete_task": {
      const ok = tasksRepo.deleteTask(db, str(data, "task_id"));
      return ok ? `deleted task ${str(data, "task_id")}` : "error: task not found";
    }
    case "duplicate_task": {
      const dup = tasksRepo.duplicateTask(db, str(data, "task_id"), boardId);
      return `duplicated task as ${dup.id}`;
    }
    case "archive_task": {
      const ok = archiveRepo.archiveTask(db, str(data, "task_id"));
      return ok ? `archived task ${str(data, "task_id")}` : "error: task not found";
    }
    case "unarchive_task": {
      const ok = archiveRepo.unarchiveTask(db, str(data, "task_id"));
      return ok ? `unarchived task ${str(data, "task_id")}` : "error: task not found";
    }
    case "claim_task": {
      const result = tasksRepo.claimTask(db, boardId, str(data, "agent_id"));
      if (!result) return "no claimable tasks";
      return `claimed task ${result.task.id}`;
    }
    case "release_task": {
      tasksRepo.releaseTask(db, str(data, "task_id"));
      return `released task ${str(data, "task_id")}`;
    }

    // ---- Column ----
    case "create_column": {
      const col = columnsRepo.createColumn(
        db,
        boardId,
        str(data, "name"),
        optNum(data, "wip_limit"),
        optStr(data, "color"),
      );
      return `created column ${col.id}`;
    }
    case "update_column": {
      const ok = columnsRepo.updateColumn(db, str(data, "column_id"), {
        name: optStr(data, "name"),
        wipLimit: optNum(data, "wip_limit"),
        color: optStr(data, "color"),
      });
      return ok ? `updated column ${str(data, "column_id")}` : "error: column not found";
    }
    case "move_column": {
      const ok = columnsRepo.moveColumn(db, str(data, "column_id"), num(data, "position"));
      return ok ? `moved column ${str(data, "column_id")}` : "error: column not found";
    }
    case "delete_column": {
      const ok = columnsRepo.deleteColumn(db, str(data, "column_id"));
      return ok ? `deleted column ${str(data, "column_id")}` : "error: column not found";
    }
    case "archive_column": {
      const count = columnsRepo.archiveColumn(db, str(data, "column_id"));
      return `archived column ${str(data, "column_id")} (${count} tasks archived)`;
    }
    case "unarchive_column": {
      const count = columnsRepo.unarchiveColumn(db, str(data, "column_id"));
      return `unarchived column ${str(data, "column_id")} (${count} tasks unarchived)`;
    }

    // ---- Board ----
    case "create_board": {
      const board = boardsRepo.createBoard(db, str(data, "name"), optStr(data, "description"));
      return `created board ${board.id}`;
    }
    case "update_board": {
      const result = boardsRepo.updateBoard(db, boardId, {
        name: optStr(data, "name"),
        description: optStr(data, "description"),
        repo_url: optStr(data, "repo_url"),
      });
      if (!result) return "error: board not found";
      return `updated board ${result.id}`;
    }
    case "delete_board": {
      const ok = boardsRepo.deleteBoard(db, boardId);
      return ok ? `deleted board ${boardId}` : "error: board not found";
    }
    case "duplicate_board": {
      const board = boardsRepo.duplicateBoard(
        db,
        boardId,
        str(data, "name"),
        bool(data, "include_tasks", true),
        str(data, "owner_id"),
      );
      return `duplicated board as ${board.id}`;
    }
    case "add_member": {
      boardsRepo.addMember(db, boardId, str(data, "user_id"), optStr(data, "role") ?? "member");
      return `added member ${str(data, "user_id")}`;
    }
    case "remove_member": {
      const ok = boardsRepo.removeMember(db, boardId, str(data, "user_id"));
      return ok ? `removed member ${str(data, "user_id")}` : "error: member not found";
    }

    // ---- Label ----
    case "create_label": {
      const label = labelsRepo.createLabel(db, boardId, str(data, "name"), str(data, "color"));
      return `created label ${label.id}`;
    }
    case "update_label": {
      const ok = labelsRepo.updateLabel(db, str(data, "label_id"), {
        name: optStr(data, "name"),
        color: optStr(data, "color"),
      });
      return ok ? `updated label ${str(data, "label_id")}` : "error: label not found";
    }
    case "delete_label": {
      const ok = labelsRepo.deleteLabel(db, str(data, "label_id"));
      return ok ? `deleted label ${str(data, "label_id")}` : "error: label not found";
    }
    case "add_label_to_task": {
      labelsRepo.attachLabel(db, str(data, "task_id"), str(data, "label_id"));
      return `added label ${str(data, "label_id")} to task ${str(data, "task_id")}`;
    }
    case "remove_label_from_task": {
      labelsRepo.detachLabel(db, str(data, "task_id"), str(data, "label_id"));
      return `removed label ${str(data, "label_id")} from task ${str(data, "task_id")}`;
    }

    // ---- Comment ----
    case "create_comment": {
      const comment = commentsRepo.createComment(
        db,
        str(data, "task_id"),
        str(data, "user_id"),
        str(data, "content"),
      );
      return `created comment ${comment.id}`;
    }
    case "update_comment": {
      const result = commentsRepo.updateComment(db, str(data, "comment_id"), str(data, "content"));
      if (!result) return "error: comment not found";
      return `updated comment ${result.id}`;
    }
    case "delete_comment": {
      const ok = commentsRepo.deleteComment(db, str(data, "comment_id"));
      return ok ? `deleted comment ${str(data, "comment_id")}` : "error: comment not found";
    }

    // ---- Subtask ----
    case "create_subtask": {
      const sub = subtasksRepo.createSubtask(db, str(data, "task_id"), str(data, "title"));
      return `created subtask ${sub.id}`;
    }
    case "update_subtask": {
      const result = subtasksRepo.updateSubtask(db, str(data, "subtask_id"), str(data, "title"));
      if (!result) return "error: subtask not found";
      return `updated subtask ${result.id}`;
    }
    case "delete_subtask": {
      const ok = subtasksRepo.deleteSubtask(db, str(data, "subtask_id"));
      return ok ? `deleted subtask ${str(data, "subtask_id")}` : "error: subtask not found";
    }
    case "toggle_subtask": {
      const result = subtasksRepo.toggleSubtask(db, str(data, "subtask_id"));
      if (!result) return "error: subtask not found";
      return `toggled subtask ${result.id} (completed=${result.completed})`;
    }
    case "move_subtask": {
      const ok = subtasksRepo.moveSubtask(db, str(data, "subtask_id"), num(data, "position"));
      return ok ? `moved subtask ${str(data, "subtask_id")}` : "error: subtask not found";
    }

    // ---- Custom Field ----
    case "create_custom_field": {
      const field = customFieldsRepo.createCustomField(
        db,
        boardId,
        str(data, "name"),
        str(data, "field_type") as import("@tarmak/shared").FieldType,
        optStr(data, "config"),
      );
      return `created custom field ${field.id}`;
    }
    case "update_custom_field": {
      const ok = customFieldsRepo.updateCustomField(db, str(data, "field_id"), {
        name: optStr(data, "name"),
        config: optStr(data, "config"),
        position: optNum(data, "position"),
      });
      return ok ? `updated custom field ${str(data, "field_id")}` : "error: custom field not found";
    }
    case "delete_custom_field": {
      const ok = customFieldsRepo.deleteCustomField(db, str(data, "field_id"));
      return ok ? `deleted custom field ${str(data, "field_id")}` : "error: custom field not found";
    }
    case "set_field_value": {
      customFieldsRepo.setFieldValue(
        db,
        str(data, "task_id"),
        str(data, "field_id"),
        str(data, "value"),
      );
      return `set field ${str(data, "field_id")} on task ${str(data, "task_id")}`;
    }

    // ---- Attachment ----
    case "delete_attachment": {
      const ok = attachmentsRepo.deleteAttachment(db, str(data, "attachment_id"));
      return ok
        ? `deleted attachment ${str(data, "attachment_id")}`
        : "error: attachment not found";
    }

    default:
      return `error: unknown action '${action}'`;
  }
}

export function registerBoardMutateTool(server: McpServer, db: DB) {
  server.tool(
    "board_mutate",
    "Modify kanban board state",
    {
      board_id: z.string().describe("Board UUID"),
      action: z.string().describe("Action to perform"),
      data: z.record(z.unknown()).default({}).describe("Action-specific data"),
    },
    async (args) => {
      try {
        // Validate board exists (except for create_board which creates a new one)
        if (args.action !== "create_board") {
          const board = boardsRepo.getBoard(db, args.board_id);
          if (!board) {
            return text(`error: board ${args.board_id} not found`);
          }
        }
        const result = handleMutate(db, args.board_id, args.action, args.data as MutateData);
        return text(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(`error: ${msg}`);
      }
    },
  );
}
