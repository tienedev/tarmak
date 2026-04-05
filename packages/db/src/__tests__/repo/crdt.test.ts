import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import { createBoard } from "../../repo/boards";
import { loadState, saveState } from "../../repo/crdt";

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
    it("saves and loads state as Uint8Array", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = new Uint8Array([0x01, 0x02, 0x03, 0xff, 0x00, 0xab]);
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded).toBeInstanceOf(Uint8Array);
      expect(new Uint8Array(loaded!)).toEqual(data);
    });

    it("overwrites existing state (upsert)", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data1 = new Uint8Array([0x01, 0x02]);
      const data2 = new Uint8Array([0x03, 0x04, 0x05]);

      saveState(db, board.id, data1);
      saveState(db, board.id, data2);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(new Uint8Array(loaded!)).toEqual(data2);
    });

    it("handles empty Uint8Array", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = new Uint8Array(0);
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.length).toBe(0);
    });

    it("handles large Uint8Array", () => {
      const db = setup();
      const board = createBoard(db, "Board");

      const data = new Uint8Array(1024 * 100).fill(0xab); // 100KB
      saveState(db, board.id, data);

      const loaded = loadState(db, board.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.length).toBe(data.length);
      expect(new Uint8Array(loaded!)).toEqual(data);
    });
  });
});
