import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import type { DB } from "../../connection";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import {
  attachLabel,
  createLabel,
  deleteLabel,
  detachLabel,
  getTaskLabels,
  listLabels,
  updateLabel,
} from "../../repo/labels";
import { createTask, getTaskWithRelations } from "../../repo/tasks";

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

describe("labels repo", () => {
  describe("createLabel", () => {
    it("creates a label with UUID and created_at", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const label = createLabel(db, board.id, "Bug", "#ff0000");
      expect(label.id).toBeDefined();
      expect(label.board_id).toBe(board.id);
      expect(label.name).toBe("Bug");
      expect(label.color).toBe("#ff0000");
      expect(label.created_at).toBeDefined();
    });

    it("generates unique IDs", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const l1 = createLabel(db, board.id, "Bug", "#f00");
      const l2 = createLabel(db, board.id, "Feature", "#0f0");
      expect(l1.id).not.toBe(l2.id);
    });
  });

  describe("listLabels", () => {
    it("returns empty array when no labels", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(listLabels(db, board.id)).toEqual([]);
    });

    it("returns all labels for a board", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      createLabel(db, board.id, "Bug", "#f00");
      createLabel(db, board.id, "Feature", "#0f0");

      const all = listLabels(db, board.id);
      expect(all).toHaveLength(2);
    });

    it("does not return labels from other boards", () => {
      const db = setup();
      const board1 = createBoard(db, "Board 1");
      const board2 = createBoard(db, "Board 2");

      createLabel(db, board1.id, "Bug", "#f00");
      createLabel(db, board2.id, "Feature", "#0f0");

      expect(listLabels(db, board1.id)).toHaveLength(1);
      expect(listLabels(db, board2.id)).toHaveLength(1);
    });
  });

  describe("updateLabel", () => {
    it("updates the name", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const label = createLabel(db, board.id, "Bug", "#f00");

      expect(updateLabel(db, label.id, { name: "Defect" })).toBe(true);

      const all = listLabels(db, board.id);
      expect(all[0].name).toBe("Defect");
    });

    it("updates the color", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const label = createLabel(db, board.id, "Bug", "#f00");

      expect(updateLabel(db, label.id, { color: "#00f" })).toBe(true);

      const all = listLabels(db, board.id);
      expect(all[0].color).toBe("#00f");
    });

    it("returns false for non-existent label", () => {
      const db = setup();
      expect(updateLabel(db, "nonexistent", { name: "X" })).toBe(false);
    });

    it("returns false when no updates provided", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const label = createLabel(db, board.id, "Bug", "#f00");
      expect(updateLabel(db, label.id, {})).toBe(false);
    });
  });

  describe("deleteLabel", () => {
    it("deletes an existing label", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const label = createLabel(db, board.id, "Bug", "#f00");

      expect(deleteLabel(db, label.id)).toBe(true);
      expect(listLabels(db, board.id)).toHaveLength(0);
    });

    it("returns false for non-existent label", () => {
      const db = setup();
      expect(deleteLabel(db, "nonexistent")).toBe(false);
    });
  });

  describe("attachLabel / detachLabel", () => {
    it("attaches a label to a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const label = createLabel(db, board.id, "Bug", "#f00");

      attachLabel(db, task.id, label.id);

      const taskLabels = getTaskLabels(db, task.id);
      expect(taskLabels).toHaveLength(1);
      expect(taskLabels[0].name).toBe("Bug");
    });

    it("attaches multiple labels to a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const l1 = createLabel(db, board.id, "Bug", "#f00");
      const l2 = createLabel(db, board.id, "Feature", "#0f0");

      attachLabel(db, task.id, l1.id);
      attachLabel(db, task.id, l2.id);

      const taskLabels = getTaskLabels(db, task.id);
      expect(taskLabels).toHaveLength(2);
    });

    it("attaching same label twice is idempotent", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const label = createLabel(db, board.id, "Bug", "#f00");

      attachLabel(db, task.id, label.id);
      attachLabel(db, task.id, label.id);
      const t = getTaskWithRelations(db, task.id);
      expect(t?.labels.filter((l: any) => l.id === label.id)).toHaveLength(1);
    });

    it("detaches a label from a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const label = createLabel(db, board.id, "Bug", "#f00");

      attachLabel(db, task.id, label.id);
      detachLabel(db, task.id, label.id);

      expect(getTaskLabels(db, task.id)).toHaveLength(0);
    });

    it("detach is a no-op for non-existent association", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);

      // Should not throw
      detachLabel(db, task.id, "nonexistent-label");
    });
  });

  describe("getTaskLabels", () => {
    it("returns empty array when task has no labels", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(getTaskLabels(db, task.id)).toEqual([]);
    });

    it("returns full label objects via JOIN", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const label = createLabel(db, board.id, "Bug", "#f00");

      attachLabel(db, task.id, label.id);

      const taskLabels = getTaskLabels(db, task.id);
      expect(taskLabels[0]).toMatchObject({
        id: label.id,
        board_id: board.id,
        name: "Bug",
        color: "#f00",
      });
    });
  });
});
