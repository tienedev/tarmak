import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import type { DB } from "../../connection";
import { createBoard } from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createComment, deleteComment, listComments, updateComment } from "../../repo/comments";
import { createTask } from "../../repo/tasks";
import { users } from "../../schema/users";

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

describe("comments repo", () => {
  describe("createComment", () => {
    it("creates a comment with UUID and created_at", () => {
      const db = setup();
      const user = seedUser(db);
      const { task } = seedBoardColumnTask(db);

      const comment = createComment(db, task.id, user.id, "Hello world");
      expect(comment.id).toBeDefined();
      expect(comment.task_id).toBe(task.id);
      expect(comment.user_id).toBe(user.id);
      expect(comment.content).toBe("Hello world");
      expect(comment.created_at).toBeDefined();
      expect(comment.updated_at).toBeNull();
    });

    it("generates unique IDs", () => {
      const db = setup();
      const user = seedUser(db);
      const { task } = seedBoardColumnTask(db);

      const c1 = createComment(db, task.id, user.id, "Comment 1");
      const c2 = createComment(db, task.id, user.id, "Comment 2");
      expect(c1.id).not.toBe(c2.id);
    });
  });

  describe("listComments", () => {
    it("returns empty array when no comments", () => {
      const db = setup();
      const { task } = seedBoardColumnTask(db);
      expect(listComments(db, task.id)).toEqual([]);
    });

    it("returns comments ordered by created_at ASC with user_name", () => {
      const db = setup();
      const user = seedUser(db);
      const { task } = seedBoardColumnTask(db);

      createComment(db, task.id, user.id, "First");
      createComment(db, task.id, user.id, "Second");

      const all = listComments(db, task.id);
      expect(all).toHaveLength(2);
      expect(all[0].content).toBe("First");
      expect(all[1].content).toBe("Second");
      expect(all[0].user_name).toBe("Alice");
    });

    it("includes user_name from joined users table", () => {
      const db = setup();
      const alice = seedUser(db, "u1", "Alice", "alice@test.com");
      const bob = seedUser(db, "u2", "Bob", "bob@test.com");
      const { task } = seedBoardColumnTask(db);

      createComment(db, task.id, alice.id, "Alice says hi");
      createComment(db, task.id, bob.id, "Bob says hi");

      const all = listComments(db, task.id);
      expect(all[0].user_name).toBe("Alice");
      expect(all[1].user_name).toBe("Bob");
    });

    it("does not return comments from other tasks", () => {
      const db = setup();
      const user = seedUser(db);
      const board = createBoard(db, "Board");
      const col = createColumn(db, board.id, "Todo");
      const task1 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });
      const task2 = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 2" });

      createComment(db, task1.id, user.id, "On task 1");
      createComment(db, task2.id, user.id, "On task 2");

      expect(listComments(db, task1.id)).toHaveLength(1);
      expect(listComments(db, task2.id)).toHaveLength(1);
    });
  });

  describe("updateComment", () => {
    it("updates content and sets updated_at", () => {
      const db = setup();
      const user = seedUser(db);
      const { task } = seedBoardColumnTask(db);

      const comment = createComment(db, task.id, user.id, "Original");
      const updated = updateComment(db, comment.id, "Edited");

      expect(updated).not.toBeNull();
      expect(updated?.content).toBe("Edited");
      expect(updated?.updated_at).toBeDefined();
      expect(updated?.updated_at).not.toBeNull();
    });

    it("returns null for non-existent comment", () => {
      const db = setup();
      expect(updateComment(db, "nonexistent", "Content")).toBeNull();
    });
  });

  describe("deleteComment", () => {
    it("deletes an existing comment", () => {
      const db = setup();
      const user = seedUser(db);
      const { task } = seedBoardColumnTask(db);

      const comment = createComment(db, task.id, user.id, "To delete");
      expect(deleteComment(db, comment.id)).toBe(true);
      expect(listComments(db, task.id)).toHaveLength(0);
    });

    it("returns false for non-existent comment", () => {
      const db = setup();
      expect(deleteComment(db, "nonexistent")).toBe(false);
    });
  });
});
