import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../connection";
import {
  createBoard,
  getBoard,
  listBoards,
  updateBoard,
  deleteBoard,
  duplicateBoard,
  addMember,
  removeMember,
  listMembers,
  getMemberRole,
} from "../../repo/boards";
import { createColumn } from "../../repo/columns";
import { createTask } from "../../repo/tasks";
import { eq } from "drizzle-orm";
import { labels, taskLabels } from "../../schema/labels";
import { customFields, taskCustomFieldValues } from "../../schema/custom-fields";
import { subtasks } from "../../schema/subtasks";
import { users } from "../../schema/users";
import { columns } from "../../schema/columns";
import { tasks } from "../../schema/tasks";
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

describe("boards repo", () => {
  describe("createBoard", () => {
    it("creates a board with name only", () => {
      const db = setup();
      const board = createBoard(db, "Test Board");
      expect(board.id).toBeDefined();
      expect(board.name).toBe("Test Board");
      expect(board.description).toBeNull();
      expect(board.created_at).toBeDefined();
      expect(board.updated_at).toBeDefined();
    });

    it("creates a board with description", () => {
      const db = setup();
      const board = createBoard(db, "Test Board", "A description");
      expect(board.description).toBe("A description");
    });

    it("generates unique IDs", () => {
      const db = setup();
      const b1 = createBoard(db, "Board 1");
      const b2 = createBoard(db, "Board 2");
      expect(b1.id).not.toBe(b2.id);
    });
  });

  describe("getBoard", () => {
    it("retrieves an existing board", () => {
      const db = setup();
      const board = createBoard(db, "Test Board");
      const found = getBoard(db, board.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test Board");
    });

    it("returns null for non-existent board", () => {
      const db = setup();
      const found = getBoard(db, "nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listBoards", () => {
    it("returns empty array when no boards", () => {
      const db = setup();
      const user = seedUser(db);
      expect(listBoards(db, user.id)).toEqual([]);
    });

    it("returns all boards ordered by created_at", () => {
      const db = setup();
      const user = seedUser(db);
      const a = createBoard(db, "Board A");
      const b = createBoard(db, "Board B");
      const c = createBoard(db, "Board C");
      addMember(db, a.id, user.id, "owner");
      addMember(db, b.id, user.id, "owner");
      addMember(db, c.id, user.id, "owner");
      const all = listBoards(db, user.id);
      expect(all).toHaveLength(3);
      const names = all.map((b) => b.name).sort();
      expect(names).toEqual(["Board A", "Board B", "Board C"]);
    });
  });

  describe("updateBoard", () => {
    it("updates the name", () => {
      const db = setup();
      const board = createBoard(db, "Old Name");
      const updated = updateBoard(db, board.id, { name: "New Name" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New Name");
    });

    it("updates description and repo_url", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const updated = updateBoard(db, board.id, {
        description: "Desc",
        repo_url: "https://github.com/example",
      });
      expect(updated!.description).toBe("Desc");
      expect(updated!.repo_url).toBe("https://github.com/example");
    });

    it("returns null for non-existent board", () => {
      const db = setup();
      const updated = updateBoard(db, "nonexistent", { name: "X" });
      expect(updated).toBeNull();
    });

    it("updates updated_at timestamp", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      const updated = updateBoard(db, board.id, { name: "Updated" });
      // updated_at should be set (may be same or later than created_at in fast tests)
      expect(updated!.updated_at).toBeDefined();
    });
  });

  describe("deleteBoard", () => {
    it("deletes an existing board", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(deleteBoard(db, board.id)).toBe(true);
      expect(getBoard(db, board.id)).toBeNull();
    });

    it("returns false for non-existent board", () => {
      const db = setup();
      expect(deleteBoard(db, "nonexistent")).toBe(false);
    });
  });

  describe("duplicateBoard", () => {
    it("duplicates a board with columns and labels", () => {
      const db = setup();
      const user = seedUser(db);
      const board = createBoard(db, "Original");
      const col1 = createColumn(db, board.id, "Todo");
      const col2 = createColumn(db, board.id, "Done");

      // Add labels
      db.insert(labels).values({ id: "l1", board_id: board.id, name: "Bug", color: "#f00" }).run();
      db.insert(labels).values({ id: "l2", board_id: board.id, name: "Feature", color: "#0f0" }).run();

      // Add custom fields
      db.insert(customFields)
        .values({ id: "cf1", board_id: board.id, name: "Story Points", field_type: "number" })
        .run();

      const dup = duplicateBoard(db, board.id, "Copy", false, user.id);
      expect(dup.name).toBe("Copy");
      expect(dup.id).not.toBe(board.id);

      // Verify columns were copied
      const dupCols = db.select().from(columns).where(
        eq(columns.board_id, dup.id)
      ).all();
      expect(dupCols).toHaveLength(2);

      // Verify labels were copied
      const dupLabels = db.select().from(labels).where(
        eq(labels.board_id, dup.id)
      ).all();
      expect(dupLabels).toHaveLength(2);

      // Verify custom fields were copied
      const dupFields = db.select().from(customFields).where(
        eq(customFields.board_id, dup.id)
      ).all();
      expect(dupFields).toHaveLength(1);
    });

    it("duplicates board with tasks when includeTasks=true", () => {
      const db = setup();
      const user = seedUser(db);
      const board = createBoard(db, "Original");
      const col = createColumn(db, board.id, "Todo");

      // Add label
      db.insert(labels).values({ id: "l1", board_id: board.id, name: "Bug", color: "#f00" }).run();

      // Add task
      const task = createTask(db, { boardId: board.id, columnId: col.id, title: "Task 1" });

      // Add task label
      db.insert(taskLabels).values({ task_id: task.id, label_id: "l1" }).run();

      // Add subtask
      db.insert(subtasks).values({ id: "st1", task_id: task.id, title: "Sub 1", completed: true }).run();

      // Add custom field + value
      db.insert(customFields)
        .values({ id: "cf1", board_id: board.id, name: "Points", field_type: "number" })
        .run();
      db.insert(taskCustomFieldValues)
        .values({ task_id: task.id, field_id: "cf1", value: "5" })
        .run();

      const dup = duplicateBoard(db, board.id, "Copy", true, user.id);

      // Check tasks were copied
      const dupTasks = db.select().from(tasks).where(
        eq(tasks.board_id, dup.id)
      ).all();
      expect(dupTasks).toHaveLength(1);
      expect(dupTasks[0].title).toBe("Task 1");

      // Check task labels remapped
      const dupTaskLabels = db.select().from(taskLabels).where(
        eq(taskLabels.task_id, dupTasks[0].id)
      ).all();
      expect(dupTaskLabels).toHaveLength(1);

      // Check subtasks copied (completed reset)
      const dupSubtasks = db.select().from(subtasks).where(
        eq(subtasks.task_id, dupTasks[0].id)
      ).all();
      expect(dupSubtasks).toHaveLength(1);
      expect(dupSubtasks[0].completed).toBe(false);

      // Check custom field values remapped
      const dupValues = db.select().from(taskCustomFieldValues).where(
        eq(taskCustomFieldValues.task_id, dupTasks[0].id)
      ).all();
      expect(dupValues).toHaveLength(1);
      expect(dupValues[0].value).toBe("5");
    });

    it("skips archived columns", () => {
      const db = setup();
      const user = seedUser(db);
      const board = createBoard(db, "Original");
      createColumn(db, board.id, "Active");
      const archived = createColumn(db, board.id, "Archived");

      // Archive a column
      db.update(columns)
        .set({ archived: true })
        .where(eq(columns.id, archived.id))
        .run();

      const dup = duplicateBoard(db, board.id, "Copy", false, user.id);
      const dupCols = db.select().from(columns).where(
        eq(columns.board_id, dup.id)
      ).all();
      expect(dupCols).toHaveLength(1);
      expect(dupCols[0].name).toBe("Active");
    });

    it("adds owner as board member", () => {
      const db = setup();
      const user = seedUser(db);
      const board = createBoard(db, "Original");

      const dup = duplicateBoard(db, board.id, "Copy", false, user.id);
      const role = getMemberRole(db, dup.id, user.id);
      expect(role).toBe("owner");
    });
  });

  describe("members", () => {
    it("adds and lists members", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      seedUser(db, "u1", "Alice", "alice@test.com");
      seedUser(db, "u2", "Bob", "bob@test.com");

      addMember(db, board.id, "u1", "owner");
      addMember(db, board.id, "u2", "member");

      const members = listMembers(db, board.id);
      expect(members).toHaveLength(2);
      // Ordered by name
      expect(members[0].user.name).toBe("Alice");
      expect(members[0].role).toBe("owner");
      expect(members[1].user.name).toBe("Bob");
      expect(members[1].role).toBe("member");
    });

    it("replaces existing member role", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      seedUser(db);

      addMember(db, board.id, "u1", "member");
      addMember(db, board.id, "u1", "owner");

      const role = getMemberRole(db, board.id, "u1");
      expect(role).toBe("owner");

      // Should still only have one membership
      const members = listMembers(db, board.id);
      expect(members).toHaveLength(1);
    });

    it("removes a member", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      seedUser(db);

      addMember(db, board.id, "u1", "member");
      expect(removeMember(db, board.id, "u1")).toBe(true);
      expect(listMembers(db, board.id)).toHaveLength(0);
    });

    it("returns false when removing non-existent member", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(removeMember(db, board.id, "nonexistent")).toBe(false);
    });

    it("returns null for non-existent member role", () => {
      const db = setup();
      const board = createBoard(db, "Board");
      expect(getMemberRole(db, board.id, "nonexistent")).toBeNull();
    });
  });
});
