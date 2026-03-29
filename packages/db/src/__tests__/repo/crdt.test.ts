import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import { loadState, saveState } from "../../repo/crdt";
import { createBoard } from "../../repo/boards";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

describe("crdt repo", () => {
  describe("loadState", () => {
    it("returns null for non-existent board state", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const state = loadState(db, board.id);
      expect(state).toBeNull();
    });
  });

  describe("saveState / loadState", () => {
    it("saves and loads state as Buffer", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = Buffer.from([0x01, 0x02, 0x03, 0xff, 0x00, 0xab]);
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(Buffer.isBuffer(loaded)).toBe(true);
      expect(loaded!.equals(data)).toBe(true);
    });

    it("overwrites existing state (upsert)", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data1 = Buffer.from([0x01, 0x02]);
      const data2 = Buffer.from([0x03, 0x04, 0x05]);

      saveState(db, board.id, data1);
      saveState(db, board.id, data2);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.equals(data2)).toBe(true);
    });

    it("handles empty buffer", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = Buffer.alloc(0);
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.length).toBe(0);
    });

    it("handles large buffer", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = Buffer.alloc(1024 * 100, 0xab); // 100KB
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.length).toBe(data.length);
      expect(loaded!.equals(data)).toBe(true);
    });
  });
});
