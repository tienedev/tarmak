import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import { search } from "../../repo/search";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createTask } from "../../repo/tasks";
import { tasks } from "../../schema/tasks";
import { eq } from "drizzle-orm";
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

describe("search repo", () => {
  describe("search", () => {
    it("finds a task by title words", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      createTask(db, { boardId: board.id, columnId: col.id, title: "Fix authentication bug" });

      const results = search(db, board.id, "authentication");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entity_type).toBe("task");
      expect(results[0].board_id).toBe(board.id);
      expect(results[0].snippet).toContain("authentication");
    });

    it("finds a task by description words", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Task",
        description: "The login flow has a regression",
      });

      const results = search(db, board.id, "regression");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entity_type).toBe("task");
    });

    it("returns empty array when no results", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      createTask(db, { boardId: board.id, columnId: col.id, title: "Some task" });

      const results = search(db, board.id, "nonexistentword");
      expect(results).toHaveLength(0);
    });

    it("scopes search to the given board", () => {
      const db = setup();
      const board1 = createBoard(db, "Board 1");
      const col1 = createColumn(db, board1.id, "Todo");
      const board2 = createBoard(db, "Board 2");
      const col2 = createColumn(db, board2.id, "Todo");

      createTask(db, { boardId: board1.id, columnId: col1.id, title: "Shared keyword" });
      createTask(db, { boardId: board2.id, columnId: col2.id, title: "Shared keyword" });

      const results = search(db, board1.id, "keyword");
      expect(results).toHaveLength(1);
      expect(results[0].board_id).toBe(board1.id);
    });

    it("excludes archived tasks by default", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const task = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Archivable task",
      });
      db.update(tasks).set({ archived: true }).where(eq(tasks.id, task.id)).run();

      const results = search(db, board.id, "archivable");
      expect(results).toHaveLength(0);
    });

    it("includes archived tasks when option is set", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      const task = createTask(db, {
        boardId: board.id,
        columnId: col.id,
        title: "Archivable task",
      });
      db.update(tasks).set({ archived: true }).where(eq(tasks.id, task.id)).run();

      const results = search(db, board.id, "archivable", { includeArchived: true });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].archived).toBe(true);
    });

    it("returns multiple matching tasks", () => {
      const db = setup();
      const { board, col } = seedBoardAndColumn(db);

      createTask(db, { boardId: board.id, columnId: col.id, title: "Feature request alpha" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Feature request beta" });
      createTask(db, { boardId: board.id, columnId: col.id, title: "Bug report gamma" });

      const results = search(db, board.id, "feature");
      expect(results).toHaveLength(2);
    });
  });
});
