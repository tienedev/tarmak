import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createSubtask,
  listSubtasks,
  toggleSubtask,
  updateSubtask,
  deleteSubtask,
  moveSubtask,
  getSubtaskCount,
} from "../../repo/subtasks";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createTask } from "../../repo/tasks";
import type { DB } from "../../connection";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedBoardColumnTask(db: DB) {
  const board = createBoard(db, "Board");
  const col = createColumn(db, board.id, "Todo");
  const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
  return { board, col, task };
}

describe("subtasks repo", () => {
  describe("createSubtask", () => {
    it("creates a subtask with UUID, auto-position, and created_at", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const sub = createSubtask(db, task.id, "Subtask 1");
      expect(sub.id).toBeDefined();
      expect(sub.task_id).toBe(task.id);
      expect(sub.title).toBe("Subtask 1");
      expect(sub.completed).toBe(false);
      expect(sub.position).toBe(1);
      expect(sub.created_at).toBeDefined();
    });

    it("auto-increments position", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const s1 = createSubtask(db, task.id, "Sub 1");
      const s2 = createSubtask(db, task.id, "Sub 2");
      const s3 = createSubtask(db, task.id, "Sub 3");

      expect(s1.position).toBe(1);
      expect(s2.position).toBe(2);
      expect(s3.position).toBe(3);
    });

    it("generates unique IDs", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const s1 = createSubtask(db, task.id, "Sub 1");
      const s2 = createSubtask(db, task.id, "Sub 2");
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe("listSubtasks", () => {
    it("returns empty array when no subtasks", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(listSubtasks(db, task.id)).toEqual([]);
    });

    it("returns subtasks ordered by position ASC", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      createSubtask(db, task.id, "Sub A");
      createSubtask(db, task.id, "Sub B");
      createSubtask(db, task.id, "Sub C");

      const all = listSubtasks(db, task.id);
      expect(all).toHaveLength(3);
      expect(all[0].title).toBe("Sub A");
      expect(all[1].title).toBe("Sub B");
      expect(all[2].title).toBe("Sub C");
    });

    it("does not return subtasks from other tasks", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");
      const task1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      createSubtask(db, task1.id, "Sub on task 1");
      createSubtask(db, task2.id, "Sub on task 2");

      expect(listSubtasks(db, task1.id)).toHaveLength(1);
      expect(listSubtasks(db, task2.id)).toHaveLength(1);
    });
  });

  describe("toggleSubtask", () => {
    it("toggles completed from false to true", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      const sub = createSubtask(db, task.id, "Sub");

      expect(sub.completed).toBe(false);
      const toggled = toggleSubtask(db, sub.id);
      expect(toggled).not.toBeNull();
      expect(toggled!.completed).toBe(true);
    });

    it("toggles completed from true back to false", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      const sub = createSubtask(db, task.id, "Sub");

      toggleSubtask(db, sub.id); // false -> true
      const toggled = toggleSubtask(db, sub.id); // true -> false
      expect(toggled!.completed).toBe(false);
    });

    it("returns null for non-existent subtask", () => {
      const db = setup();
      expect(toggleSubtask(db, "nonexistent")).toBeNull();
    });
  });

  describe("updateSubtask", () => {
    it("updates the title", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      const sub = createSubtask(db, task.id, "Old Title");

      const updated = updateSubtask(db, sub.id, "New Title");
      expect(updated).not.toBeNull();
      expect(updated!.title).toBe("New Title");
    });

    it("returns null for non-existent subtask", () => {
      const db = setup();
      expect(updateSubtask(db, "nonexistent", "Title")).toBeNull();
    });
  });

  describe("deleteSubtask", () => {
    it("deletes an existing subtask", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      const sub = createSubtask(db, task.id, "Sub");

      expect(deleteSubtask(db, sub.id)).toBe(true);
      expect(listSubtasks(db, task.id)).toHaveLength(0);
    });

    it("returns false for non-existent subtask", () => {
      const db = setup();
      expect(deleteSubtask(db, "nonexistent")).toBe(false);
    });
  });

  describe("moveSubtask", () => {
    it("moves subtask to new position", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      const sub = createSubtask(db, task.id, "Sub");

      expect(moveSubtask(db, sub.id, 5)).toBe(true);

      const all = listSubtasks(db, task.id);
      expect(all[0].position).toBe(5);
    });

    it("returns false for non-existent subtask", () => {
      const db = setup();
      expect(moveSubtask(db, "nonexistent", 0)).toBe(false);
    });
  });

  describe("getSubtaskCount", () => {
    it("returns zero counts when no subtasks", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const count = getSubtaskCount(db, task.id);
      expect(count).toEqual({ completed: 0, total: 0 });
    });

    it("counts completed and total subtasks", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const s1 = createSubtask(db, task.id, "Sub 1");
      createSubtask(db, task.id, "Sub 2");
      const s3 = createSubtask(db, task.id, "Sub 3");

      toggleSubtask(db, s1.id); // complete
      toggleSubtask(db, s3.id); // complete

      const count = getSubtaskCount(db, task.id);
      expect(count).toEqual({ completed: 2, total: 3 });
    });

    it("updates count after toggle back", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      const sub = createSubtask(db, task.id, "Sub");
      toggleSubtask(db, sub.id); // complete
      toggleSubtask(db, sub.id); // uncomplete

      const count = getSubtaskCount(db, task.id);
      expect(count).toEqual({ completed: 0, total: 1 });
    });
  });
});
