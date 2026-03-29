import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  archiveTask,
  unarchiveTask,
  listArchivedTasks,
  listArchivedColumns,
} from "../../repo/archive";
import { createBoard } from "../../repo/boards";
import { createColumn, archiveColumn } from "../../repo/columns";
import { createTask, getTask } from "../../repo/tasks";
import type { DB } from "../../connection";

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

describe("archive repo", () => {
  describe("archiveTask", () => {
    it("archives a task", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      const result = archiveTask(db, task.id);
      expect(result).toBe(true);

      const archived = getTask(db, task.id);
      expect(archived!.archived).toBe(true);
      expect(archived!.updated_at).not.toBe(task.updated_at);
    });

    it("returns false for non-existent task", () => {
      const db = setup();
      expect(archiveTask(db, "nonexistent")).toBe(false);
    });
  });

  describe("unarchiveTask", () => {
    it("unarchives a task back to its column", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      archiveTask(db, task.id);
      const result = unarchiveTask(db, task.id);
      expect(result).toBe(true);

      const restored = getTask(db, task.id);
      expect(restored!.archived).toBe(false);
      expect(restored!.column_id).toBe(col.id);
    });

    it("moves task to first active column if parent column is archived", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const col2 = createColumn(db, board.id, "Done");
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      // Archive the column (which also archives its tasks)
      archiveColumn(db, col.id);

      // Unarchive just the task — it should move to col2 (first active column)
      const result = unarchiveTask(db, task.id);
      expect(result).toBe(true);

      const restored = getTask(db, task.id);
      expect(restored!.archived).toBe(false);
      expect(restored!.column_id).toBe(col2.id);
    });

    it("returns false for non-existent task", () => {
      const db = setup();
      expect(unarchiveTask(db, "nonexistent")).toBe(false);
    });

    it("returns false if no active columns available", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task" });

      // Archive the only column
      archiveColumn(db, col.id);

      // Try to unarchive the task — no active columns
      const result = unarchiveTask(db, task.id);
      expect(result).toBe(false);
    });
  });

  describe("listArchivedTasks", () => {
    it("returns only archived tasks for a board", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      const t1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Active" });
      const t2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Archived" });

      archiveTask(db, t2.id);

      const archived = listArchivedTasks(db, board.id);
      expect(archived).toHaveLength(1);
      expect(archived[0].title).toBe("Archived");
    });

    it("returns empty array when no archived tasks", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);
      createTask(db, { boardId: board.id, columnId: col.id, title: "Active" });

      const archived = listArchivedTasks(db, board.id);
      expect(archived).toHaveLength(0);
    });
  });

  describe("listArchivedColumns", () => {
    it("returns only archived columns for a board", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col1 = createColumn(db, board.id, "Todo");
      const col2 = createColumn(db, board.id, "Done");

      archiveColumn(db, col2.id);

      const archived = listArchivedColumns(db, board.id);
      expect(archived).toHaveLength(1);
      expect(archived[0].name).toBe("Done");
    });

    it("returns empty array when no archived columns", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      createColumn(db, board.id, "Todo");

      const archived = listArchivedColumns(db, board.id);
      expect(archived).toHaveLength(0);
    });
  });
});
