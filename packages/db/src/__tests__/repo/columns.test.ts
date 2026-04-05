import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createColumn,
  listColumns,
  updateColumn,
  deleteColumn,
  moveColumn,
  archiveColumn,
  unarchiveColumn,
} from "../../repo/columns";
import { createBoard } from "../../repo/boards";
import { createTask } from "../../repo/tasks";
import { tasks } from "../../schema/tasks";
import { columns } from "../../schema/columns";
import { eq } from "drizzle-orm";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

describe("columns repo", () => {
  describe("createColumn", () => {
    it("creates a column with auto-position", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");
      expect(col.id).toBeDefined();
      expect(col.name).toBe("Todo");
      expect(col.board_id).toBe(board.id);
      expect(col.position).toBe(1);
      expect(col.archived).toBe(false);
    });

    it("auto-increments position", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col1 = createColumn(db, board.id, "Todo");
      const col2 = createColumn(db, board.id, "In Progress");
      const col3 = createColumn(db, board.id, "Done");
      expect(col1.position).toBe(1);
      expect(col2.position).toBe(2);
      expect(col3.position).toBe(3);
    });

    it("creates column with optional wip_limit and color", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "WIP", 3, "#ff0000");
      expect(col.wip_limit).toBe(3);
      expect(col.color).toBe("#ff0000");
    });
  });

  describe("listColumns", () => {
    it("returns empty array for board with no columns", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(listColumns(db, board.id)).toEqual([]);
    });

    it("returns non-archived columns ordered by position", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      createColumn(db, board.id, "Todo");
      createColumn(db, board.id, "In Progress");
      createColumn(db, board.id, "Done");

      const cols = listColumns(db, board.id);
      expect(cols).toHaveLength(3);
      expect(cols[0].name).toBe("Todo");
      expect(cols[1].name).toBe("In Progress");
      expect(cols[2].name).toBe("Done");
    });

    it("excludes archived columns", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Archived");
      createColumn(db, board.id, "Active");

      db.update(columns).set({ archived: true }).where(eq(columns.id, col.id)).run();

      const cols = listColumns(db, board.id);
      expect(cols).toHaveLength(1);
      expect(cols[0].name).toBe("Active");
    });
  });

  describe("updateColumn", () => {
    it("updates the name", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Old");
      expect(updateColumn(db, col.id, { name: "New" })).toBe(true);

      const updated = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updated!.name).toBe("New");
    });

    it("updates wip_limit and color", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Col");
      updateColumn(db, col.id, { wipLimit: 5, color: "#00f" });

      const updated = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updated!.wip_limit).toBe(5);
      expect(updated!.color).toBe("#00f");
    });

    it("returns false for non-existent column", () => {
      const db = setup();
      expect(updateColumn(db, "nonexistent", { name: "X" })).toBe(false);
    });
  });

  describe("deleteColumn", () => {
    it("deletes an existing column", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Col");
      expect(deleteColumn(db, col.id)).toBe(true);

      const found = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(found).toBeUndefined();
    });

    it("returns false for non-existent column", () => {
      const db = setup();
      expect(deleteColumn(db, "nonexistent")).toBe(false);
    });
  });

  describe("moveColumn", () => {
    it("updates position", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Col");
      expect(moveColumn(db, col.id, 5)).toBe(true);

      const updated = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updated!.position).toBe(5);
    });

    it("returns false for non-existent column", () => {
      const db = setup();
      expect(moveColumn(db, "nonexistent", 3)).toBe(false);
    });
  });

  describe("archiveColumn", () => {
    it("archives column and all its tasks", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");

      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 3" });

      const count = archiveColumn(db, col.id);
      expect(count).toBe(3);

      // Column should be archived
      const updatedCol = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updatedCol!.archived).toBe(true);

      // All tasks should be archived
      const archivedTasks = db.select().from(tasks).where(eq(tasks.column_id, col.id)).all();
      expect(archivedTasks.every((t) => t.archived === true)).toBe(true);
    });

    it("returns 0 when no tasks in column", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Empty");
      const count = archiveColumn(db, col.id);
      expect(count).toBe(0);

      // Column itself should still be archived
      const updatedCol = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updatedCol!.archived).toBe(true);
    });
  });

  describe("unarchiveColumn", () => {
    it("unarchives column and all its tasks", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");

      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      archiveColumn(db, col.id);
      const count = unarchiveColumn(db, col.id);
      expect(count).toBe(2);

      // Column should be unarchived
      const updatedCol = db.select().from(columns).where(eq(columns.id, col.id)).get();
      expect(updatedCol!.archived).toBe(false);

      // All tasks should be unarchived
      const unarchivedTasks = db.select().from(tasks).where(eq(tasks.column_id, col.id)).all();
      expect(unarchivedTasks.every((t) => t.archived === false)).toBe(true);
    });
  });
});
