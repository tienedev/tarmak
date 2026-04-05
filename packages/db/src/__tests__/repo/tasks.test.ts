import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import type { DB } from "../../connection";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import {
  claimTask,
  createTask,
  deleteTask,
  duplicateTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  moveTask,
  releaseTask,
  updateTask,
} from "../../repo/tasks";
import { attachments } from "../../schema/attachments";
import { customFields, taskCustomFieldValues } from "../../schema/custom-fields";
import { labels, taskLabels } from "../../schema/labels";
import { subtasks } from "../../schema/subtasks";
import { tasks } from "../../schema/tasks";
import { users } from "../../schema/users";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedBoardAndColumn(db: DB) {
  const board = createBoard(db, "Board");
  const col = createColumn(db, board.id, "Todo");
  return { board, col };
}

describe("tasks repo", () => {
  describe("createTask", () => {
    it("creates a task with required fields", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      expect(task.id).toBeDefined();
      expect(task.title).toBe("Task 1");
      expect(task.board_id).toBe(board.id);
      expect(task.column_id).toBe(col.id);
      expect(task.priority).toBe("medium");
      expect(task.position).toBe(1);
      expect(task.archived).toBe(false);
    });

    it("auto-increments position within column", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const t1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      const t2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });
      expect(t1.position).toBe(1);
      expect(t2.position).toBe(2);
    });

    it("creates with optional fields", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const task = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Task",
        description: "A description",
        priority: "urgent",
        assignee: "user-1",
      });
      expect(task.description).toBe("A description");
      expect(task.priority).toBe("urgent");
      expect(task.assignee).toBe("user-1");
    });
  });

  describe("getTask", () => {
    it("retrieves an existing task", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const found = getTask(db, task.id);
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Task");
    });

    it("returns null for non-existent task", () => {
      const db = setup();
      expect(getTask(db, "nonexistent")).toBeNull();
    });
  });

  describe("getTaskWithRelations", () => {
    it("returns task with labels, subtask count, and attachment count", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      // Add labels
      db.insert(labels).values({ id: "l1", board_id: board.id, name: "Bug", color: "#f00" }).run();
      db.insert(labels)
        .values({ id: "l2", board_id: board.id, name: "Feature", color: "#0f0" })
        .run();
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l1" }).run();
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l2" }).run();

      // Add subtasks
      db.insert(subtasks)
        .values({ id: "st1", task_id: task.id, title: "Sub 1", completed: true })
        .run();
      db.insert(subtasks)
        .values({ id: "st2", task_id: task.id, title: "Sub 2", completed: false })
        .run();
      db.insert(subtasks)
        .values({ id: "st3", task_id: task.id, title: "Sub 3", completed: true })
        .run();

      // Add attachments
      db.insert(attachments)
        .values({
          id: "a1",
          task_id: task.id,
          board_id: board.id,
          filename: "file.txt",
          mime_type: "text/plain",
          size_bytes: 100,
          storage_key: "key1",
        })
        .run();

      const result = getTaskWithRelations(db, task.id);
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Task");
      expect(result?.labels).toHaveLength(2);
      expect(result?.labels.map((l) => l.name).sort()).toEqual(["Bug", "Feature"]);
      expect(result?.subtask_count).toEqual({ completed: 2, total: 3 });
      expect(result?.attachment_count).toBe(1);
    });

    it("returns null for non-existent task", () => {
      const db = setup();
      expect(getTaskWithRelations(db, "nonexistent")).toBeNull();
    });

    it("handles task with no relations", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Empty" });

      const result = getTaskWithRelations(db, task.id);
      expect(result).not.toBeNull();
      expect(result?.labels).toEqual([]);
      expect(result?.subtask_count).toEqual({ completed: 0, total: 0 });
      expect(result?.attachment_count).toBe(0);
    });
  });

  describe("listTasks", () => {
    it("returns non-archived tasks ordered by position", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 3" });

      const all = listTasks(db, board.id);
      expect(all).toHaveLength(3);
      expect(all[0].title).toBe("Task 1");
      expect(all[2].title).toBe("Task 3");
    });

    it("excludes archived tasks", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Archived" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Active" });

      db.update(tasks).set({ archived: true }).where(eq(tasks.id, task.id)).run();

      const all = listTasks(db, board.id);
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe("Active");
    });

    it("supports limit and offset", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      for (let i = 1; i <= 5; i++) {
        createTask(db, { boardId: board.id, columnId: col.id, title: `Task ${i}` });
      }

      const page = listTasks(db, board.id, 2, 1);
      expect(page).toHaveLength(2);
      expect(page[0].title).toBe("Task 2");
      expect(page[1].title).toBe("Task 3");
    });
  });

  describe("updateTask", () => {
    it("updates title and description", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Old" });

      const updated = updateTask(db, task.id, { title: "New", description: "Desc" });
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("New");
      expect(updated?.description).toBe("Desc");
    });

    it("updates priority and assignee", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const updated = updateTask(db, task.id, { priority: "urgent", assignee: "user-1" });
      expect(updated?.priority).toBe("urgent");
      expect(updated?.assignee).toBe("user-1");
    });

    it("updates due_date", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const updated = updateTask(db, task.id, { due_date: "2026-12-31" });
      expect(updated?.due_date).toBe("2026-12-31");
    });

    it("returns null for non-existent task", () => {
      const db = setup();
      expect(updateTask(db, "nonexistent", { title: "X" })).toBeNull();
    });
  });

  describe("deleteTask", () => {
    it("deletes an existing task", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      expect(deleteTask(db, task.id)).toBe(true);
      expect(getTask(db, task.id)).toBeNull();
    });

    it("returns false for non-existent task", () => {
      const db = setup();
      expect(deleteTask(db, "nonexistent")).toBe(false);
    });
  });

  describe("moveTask", () => {
    it("moves task to different column and position", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const col2 = createColumn(db, board.id, "Done");
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const moved = moveTask(db, task.id, col2.id, 0);
      expect(moved).not.toBeNull();
      expect(moved?.column_id).toBe(col2.id);
      expect(moved?.position).toBe(0);
    });

    it("returns null for non-existent task", () => {
      const db = setup();
      expect(moveTask(db, "nonexistent", "col-id", 0)).toBeNull();
    });
  });

  describe("claimTask", () => {
    it("claims the highest priority ai-ready task", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      // Create agent user
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();

      // Create ai-ready label
      db.insert(labels)
        .values({ id: "l-ai", board_id: board.id, name: "ai-ready", color: "#00f" })
        .run();
      db.insert(labels)
        .values({ id: "l-bug", board_id: board.id, name: "bug", color: "#f00" })
        .run();

      // Create tasks with different priorities
      const low = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Low",
        priority: "low",
      });
      const urgent = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Urgent",
        priority: "urgent",
      });
      const high = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "High",
        priority: "high",
      });

      // Only tag urgent and low as ai-ready
      db.insert(taskLabels).values({ task_id: low.id, label_id: "l-ai" }).run();
      db.insert(taskLabels).values({ task_id: urgent.id, label_id: "l-ai" }).run();
      db.insert(taskLabels).values({ task_id: urgent.id, label_id: "l-bug" }).run();

      const claimed = claimTask(db, board.id, "agent-1");
      expect(claimed).not.toBeNull();
      expect(claimed?.task.title).toBe("Urgent");
      expect(claimed?.task.locked_by).toBe("agent-1");
      expect(claimed?.labels).toContain("ai-ready");
      expect(claimed?.labels).toContain("bug");
    });

    it("returns null when no ai-ready tasks", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();

      createTask(db, { boardId: board.id, columnId: col.id, title: "Not tagged" });

      expect(claimTask(db, board.id, "agent-1")).toBeNull();
    });

    it("skips already-locked tasks", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();
      db.insert(users)
        .values({ id: "agent-2", name: "Agent2", email: "agent2@test.com", is_agent: true })
        .run();

      db.insert(labels)
        .values({ id: "l-ai", board_id: board.id, name: "ai-ready", color: "#00f" })
        .run();

      const t1 = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Task 1",
        priority: "urgent",
      });
      const t2 = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Task 2",
        priority: "high",
      });

      db.insert(taskLabels).values({ task_id: t1.id, label_id: "l-ai" }).run();
      db.insert(taskLabels).values({ task_id: t2.id, label_id: "l-ai" }).run();

      // Agent 1 claims first
      const first = claimTask(db, board.id, "agent-1");
      expect(first?.task.title).toBe("Task 1");

      // Agent 2 should get the next one
      const second = claimTask(db, board.id, "agent-2");
      expect(second?.task.title).toBe("Task 2");
    });

    it("atomic lock prevents double claim", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();
      db.insert(users)
        .values({ id: "agent-2", name: "Agent2", email: "agent2@test.com", is_agent: true })
        .run();

      db.insert(labels)
        .values({ id: "l-ai", board_id: board.id, name: "ai-ready", color: "#00f" })
        .run();

      const task = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Only Task",
        priority: "high",
      });
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l-ai" }).run();

      // Agent 1 claims
      claimTask(db, board.id, "agent-1");

      // Agent 2 gets nothing (only one ai-ready task, already claimed)
      const second = claimTask(db, board.id, "agent-2");
      expect(second).toBeNull();
    });

    it("prioritizes by due_date when priority is same", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();
      db.insert(labels)
        .values({ id: "l-ai", board_id: board.id, name: "ai-ready", color: "#00f" })
        .run();

      const t1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Later" });
      const t2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Sooner" });

      // Update due_dates directly
      db.update(tasks).set({ due_date: "2026-06-01" }).where(eq(tasks.id, t1.id)).run();
      db.update(tasks).set({ due_date: "2026-01-01" }).where(eq(tasks.id, t2.id)).run();

      db.insert(taskLabels).values({ task_id: t1.id, label_id: "l-ai" }).run();
      db.insert(taskLabels).values({ task_id: t2.id, label_id: "l-ai" }).run();

      const claimed = claimTask(db, board.id, "agent-1");
      expect(claimed?.task.title).toBe("Sooner");
    });
  });

  describe("releaseTask", () => {
    it("releases a locked task", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      db.insert(users)
        .values({ id: "agent-1", name: "Agent", email: "agent@test.com", is_agent: true })
        .run();
      db.insert(labels)
        .values({ id: "l-ai", board_id: board.id, name: "ai-ready", color: "#00f" })
        .run();

      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l-ai" }).run();

      claimTask(db, board.id, "agent-1");
      releaseTask(db, task.id);

      const released = getTask(db, task.id);
      expect(released?.locked_by).toBeNull();
      expect(released?.locked_at).toBeNull();
    });
  });

  describe("duplicateTask", () => {
    it("duplicates a task with relations", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const task = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Original",
        description: "Desc",
        priority: "high",
        assignee: "user-1",
      });

      // Add due_date
      db.update(tasks).set({ due_date: "2026-12-31" }).where(eq(tasks.id, task.id)).run();

      // Add labels
      db.insert(labels).values({ id: "l1", board_id: board.id, name: "Bug", color: "#f00" }).run();
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l1" }).run();

      // Add subtasks
      db.insert(subtasks)
        .values({ id: "st1", task_id: task.id, title: "Sub 1", completed: true })
        .run();
      db.insert(subtasks).values({ id: "st2", task_id: task.id, title: "Sub 2" }).run();

      // Add custom field value
      db.insert(customFields)
        .values({ id: "cf1", board_id: board.id, name: "Points", field_type: "number" })
        .run();
      db.insert(taskCustomFieldValues)
        .values({ task_id: task.id, field_id: "cf1", value: "8" })
        .run();

      const dup = duplicateTask(db, task.id, board.id);

      expect(dup.title).toBe("Copy of Original");
      expect(dup.id).not.toBe(task.id);
      expect(dup.description).toBe("Desc");
      expect(dup.priority).toBe("high");

      // Should NOT copy assignee and due_date
      const dupRaw = getTask(db, dup.id);
      expect(dupRaw?.assignee).toBeNull();
      expect(dupRaw?.due_date).toBeNull();

      // Position should be original + 1
      expect(dup.position).toBe(task.position + 1);

      // Labels should be copied
      expect(dup.labels).toHaveLength(1);
      expect(dup.labels[0].name).toBe("Bug");

      // Subtasks should be copied with completed=false
      expect(dup.subtask_count.total).toBe(2);
      expect(dup.subtask_count.completed).toBe(0);

      // Custom field values should be copied
      const cfVals = db
        .select()
        .from(taskCustomFieldValues)
        .where(eq(taskCustomFieldValues.task_id, dup.id))
        .all();
      expect(cfVals).toHaveLength(1);
      expect(cfVals[0].value).toBe("8");
    });

    it("shifts subsequent task positions", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const t1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      const t2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });
      const t3 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 3" });

      // Duplicate t1 (position 1). Copy goes at position 2, t2 shifts to 3, t3 to 4
      duplicateTask(db, t1.id, board.id);

      const updatedT2 = getTask(db, t2.id);
      const updatedT3 = getTask(db, t3.id);
      expect(updatedT2?.position).toBe(3);
      expect(updatedT3?.position).toBe(4);
    });
  });
});
