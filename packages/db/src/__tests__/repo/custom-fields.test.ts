import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createCustomField,
  listCustomFields,
  updateCustomField,
  deleteCustomField,
  setFieldValue,
  getFieldValues,
  deleteFieldValue,
} from "../../repo/custom-fields";
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

describe("custom-fields repo", () => {
  describe("createCustomField", () => {
    it("creates a field with UUID and auto-position", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const field = createCustomField(db, board.id, "Story Points", "number");
      expect(field.id).toBeDefined();
      expect(field.board_id).toBe(board.id);
      expect(field.name).toBe("Story Points");
      expect(field.field_type).toBe("number");
      expect(field.config).toBeNull();
      expect(field.position).toBe(1);
    });

    it("creates a field with config", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const config = JSON.stringify({ options: ["S", "M", "L"] });
      const field = createCustomField(db, board.id, "Size", "enum", config);
      expect(field.config).toBe(config);
    });

    it("auto-increments position", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const f1 = createCustomField(db, board.id, "Field 1", "text");
      const f2 = createCustomField(db, board.id, "Field 2", "number");
      const f3 = createCustomField(db, board.id, "Field 3", "url");

      expect(f1.position).toBe(1);
      expect(f2.position).toBe(2);
      expect(f3.position).toBe(3);
    });

    it("generates unique IDs", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const f1 = createCustomField(db, board.id, "Field 1", "text");
      const f2 = createCustomField(db, board.id, "Field 2", "text");
      expect(f1.id).not.toBe(f2.id);
    });
  });

  describe("listCustomFields", () => {
    it("returns empty array when no fields", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(listCustomFields(db, board.id)).toEqual([]);
    });

    it("returns fields ordered by position", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      createCustomField(db, board.id, "Field A", "text");
      createCustomField(db, board.id, "Field B", "number");

      const all = listCustomFields(db, board.id);
      expect(all).toHaveLength(2);
      expect(all[0].name).toBe("Field A");
      expect(all[1].name).toBe("Field B");
    });

    it("does not return fields from other boards", () => {
      const db = setup();
      const board1 = createBoard(db, "Board 1");
      const board2 = createBoard(db, "Board 2");

      createCustomField(db, board1.id, "Field 1", "text");
      createCustomField(db, board2.id, "Field 2", "text");

      expect(listCustomFields(db, board1.id)).toHaveLength(1);
      expect(listCustomFields(db, board2.id)).toHaveLength(1);
    });
  });

  describe("updateCustomField", () => {
    it("updates the name", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const field = createCustomField(db, board.id, "Old Name", "text");

      expect(updateCustomField(db, field.id, { name: "New Name" })).toBe(true);

      const all = listCustomFields(db, board.id);
      expect(all[0].name).toBe("New Name");
    });

    it("updates config", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const field = createCustomField(db, board.id, "Size", "enum");

      const config = JSON.stringify({ options: ["XS", "S", "M", "L", "XL"] });
      expect(updateCustomField(db, field.id, { config })).toBe(true);

      const all = listCustomFields(db, board.id);
      expect(all[0].config).toBe(config);
    });

    it("updates position", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const field = createCustomField(db, board.id, "Field", "text");

      expect(updateCustomField(db, field.id, { position: 10 })).toBe(true);

      const all = listCustomFields(db, board.id);
      expect(all[0].position).toBe(10);
    });

    it("returns false for non-existent field", () => {
      const db = setup();
      expect(updateCustomField(db, "nonexistent", { name: "X" })).toBe(false);
    });

    it("returns false when no updates provided", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const field = createCustomField(db, board.id, "Field", "text");
      expect(updateCustomField(db, field.id, {})).toBe(false);
    });
  });

  describe("deleteCustomField", () => {
    it("deletes an existing field", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const field = createCustomField(db, board.id, "Field", "text");

      expect(deleteCustomField(db, field.id)).toBe(true);
      expect(listCustomFields(db, board.id)).toHaveLength(0);
    });

    it("returns false for non-existent field", () => {
      const db = setup();
      expect(deleteCustomField(db, "nonexistent")).toBe(false);
    });
  });

  describe("setFieldValue / getFieldValues", () => {
    it("sets a field value for a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const field = createCustomField(db, board.id, "Points", "number");

      setFieldValue(db, task.id, field.id, "8");

      const values = getFieldValues(db, task.id);
      expect(values).toHaveLength(1);
      expect(values[0].task_id).toBe(task.id);
      expect(values[0].field_id).toBe(field.id);
      expect(values[0].value).toBe("8");
    });

    it("replaces existing value on duplicate (INSERT OR REPLACE)", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const field = createCustomField(db, board.id, "Points", "number");

      setFieldValue(db, task.id, field.id, "5");
      setFieldValue(db, task.id, field.id, "13");

      const values = getFieldValues(db, task.id);
      expect(values).toHaveLength(1);
      expect(values[0].value).toBe("13");
    });

    it("supports multiple fields per task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const f1 = createCustomField(db, board.id, "Points", "number");
      const f2 = createCustomField(db, board.id, "URL", "url");

      setFieldValue(db, task.id, f1.id, "5");
      setFieldValue(db, task.id, f2.id, "https://example.com");

      const values = getFieldValues(db, task.id);
      expect(values).toHaveLength(2);
    });

    it("returns empty array when no values set", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(getFieldValues(db, task.id)).toEqual([]);
    });
  });

  describe("deleteFieldValue", () => {
    it("deletes an existing field value", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);
      const field = createCustomField(db, board.id, "Points", "number");

      setFieldValue(db, task.id, field.id, "8");
      expect(deleteFieldValue(db, task.id, field.id)).toBe(true);
      expect(getFieldValues(db, task.id)).toHaveLength(0);
    });

    it("returns false when no matching value", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(deleteFieldValue(db, task.id, "nonexistent")).toBe(false);
    });
  });
});
