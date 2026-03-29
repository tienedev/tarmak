import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
  countAttachments,
} from "../../repo/attachments";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createTask } from "../../repo/tasks";
import { users } from "../../schema/users";
import type { DB } from "../../connection";

function setup() {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedUser(db: DB, id = "u1", name = "Alice", email = "alice@test.com") {
  db.insert(users).values({ id, name, email }).run();
  return { id, name, email };
}

function seedBoardColumnTask(db: DB) {
  const board = createBoard(db, "Board");
  const col = createColumn(db, board.id, "Todo");
  const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
  return { board, col, task };
}

describe("attachments repo", () => {
  describe("createAttachment", () => {
    it("creates an attachment with UUID and created_at", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const att = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12345,
        storageKey: "uploads/report.pdf",
      });

      expect(att.id).toBeDefined();
      expect(att.task_id).toBe(task.id);
      expect(att.board_id).toBe(board.id);
      expect(att.filename).toBe("report.pdf");
      expect(att.mime_type).toBe("application/pdf");
      expect(att.size_bytes).toBe(12345);
      expect(att.storage_key).toBe("uploads/report.pdf");
      expect(att.uploaded_by).toBeNull();
      expect(att.created_at).toBeDefined();
    });

    it("creates with uploaded_by", () => {
      const db = setup();
      const user = seedUser(db);
      const { board, task } = seedBoardColumnTask(db);

      const att = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        storageKey: "uploads/file.txt",
        uploadedBy: user.id,
      });

      expect(att.uploaded_by).toBe(user.id);
    });

    it("generates unique IDs", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const a1 = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        storageKey: "a",
      });
      const a2 = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        storageKey: "b",
      });

      expect(a1.id).not.toBe(a2.id);
    });
  });

  describe("listAttachments", () => {
    it("returns empty array when no attachments", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(listAttachments(db, task.id)).toEqual([]);
    });

    it("returns all attachments for a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        storageKey: "a",
      });
      createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        storageKey: "b",
      });

      expect(listAttachments(db, task.id)).toHaveLength(2);
    });

    it("does not return attachments from other tasks", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");
      const task1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      createAttachment(db, {
        taskId: task1.id,
        boardId: board.id,
        filename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        storageKey: "a",
      });
      createAttachment(db, {
        taskId: task2.id,
        boardId: board.id,
        filename: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        storageKey: "b",
      });

      expect(listAttachments(db, task1.id)).toHaveLength(1);
      expect(listAttachments(db, task2.id)).toHaveLength(1);
    });
  });

  describe("getAttachment", () => {
    it("retrieves an existing attachment", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const att = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        storageKey: "key",
      });

      const found = getAttachment(db, att.id);
      expect(found).not.toBeNull();
      expect(found!.filename).toBe("file.txt");
    });

    it("returns null for non-existent attachment", () => {
      const db = setup();
      expect(getAttachment(db, "nonexistent")).toBeNull();
    });
  });

  describe("deleteAttachment", () => {
    it("deletes an existing attachment", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      const att = createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        storageKey: "key",
      });

      expect(deleteAttachment(db, att.id)).toBe(true);
      expect(getAttachment(db, att.id)).toBeNull();
    });

    it("returns false for non-existent attachment", () => {
      const db = setup();
      expect(deleteAttachment(db, "nonexistent")).toBe(false);
    });
  });

  describe("countAttachments", () => {
    it("returns 0 when no attachments", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(countAttachments(db, task.id)).toBe(0);
    });

    it("counts attachments for a task", () => {
      const db = setup();
      const { board, task } = seedBoardColumnTask(db);

      createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        storageKey: "a",
      });
      createAttachment(db, {
        taskId: task.id,
        boardId: board.id,
        filename: "b.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        storageKey: "b",
      });

      expect(countAttachments(db, task.id)).toBe(2);
    });
  });
});
