import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type DB,
  boardsRepo,
  columnsRepo,
  createDb,
  customFieldsRepo,
  labelsRepo,
  migrateDb,
  subtasksRepo,
  tasksRepo,
  users,
} from "@tarmak/db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { exportAllData } from "../cli/export";
import { type ImportData, importData } from "../cli/import";
import { hashPassword, listUsers, resetPassword } from "../cli/users";

function createTestDb(): DB {
  const db = createDb();
  migrateDb(db);
  return db;
}

function seedBoard(db: DB) {
  const board = boardsRepo.createBoard(db, "Test Board", "A test board");
  const col1 = columnsRepo.createColumn(db, board.id, "Todo");
  const col2 = columnsRepo.createColumn(db, board.id, "Done");
  const label = labelsRepo.createLabel(db, board.id, "bug", "#ff0000");
  const task = tasksRepo.createTask(db, {
    boardId: board.id,
    columnId: col1.id,
    title: "Fix the thing",
    description: "It is broken",
    priority: "high",
  });
  labelsRepo.attachLabel(db, task.id, label.id);
  subtasksRepo.createSubtask(db, task.id, "Step 1");
  subtasksRepo.createSubtask(db, task.id, "Step 2");

  return { board, col1, col2, label, task };
}

function insertUser(db: DB, id: string, name: string, email: string) {
  db.run(sql`INSERT INTO users (id, name, email) VALUES (${id}, ${name}, ${email})`);
}

describe("CLI: export", () => {
  let db: DB;

  beforeEach(() => {
    db = createTestDb();
  });

  it("exports empty database", () => {
    const data = exportAllData(db);
    expect(data.boards).toEqual([]);
  });

  it("exports board with columns, tasks, labels, and subtasks", () => {
    const { board, col1, col2, label, task } = seedBoard(db);
    const data = exportAllData(db);

    expect(data.boards).toHaveLength(1);
    const exported = data.boards[0];
    expect(exported.name).toBe("Test Board");
    expect(exported.columns).toHaveLength(2);
    expect(exported.labels).toHaveLength(1);
    expect(exported.labels[0].name).toBe("bug");
    expect(exported.tasks).toHaveLength(1);
    expect(exported.tasks[0].title).toBe("Fix the thing");
    expect(exported.tasks[0].labels).toEqual([label.id]);
    expect(exported.tasks[0].subtasks).toHaveLength(2);
  });

  it("exports multiple boards", () => {
    seedBoard(db);
    boardsRepo.createBoard(db, "Second Board");
    const data = exportAllData(db);
    expect(data.boards).toHaveLength(2);
  });
});

describe("CLI: import", () => {
  let db: DB;

  beforeEach(() => {
    db = createTestDb();
  });

  it("imports boards from export data", () => {
    // First seed and export
    const sourceDb = createTestDb();
    seedBoard(sourceDb);
    const data = exportAllData(sourceDb);

    // Import into fresh database
    const result = importData(db, data as unknown as ImportData);
    expect(result.boardCount).toBe(1);
    expect(result.columnCount).toBe(2);
    expect(result.taskCount).toBe(1);
    expect(result.labelCount).toBe(1);

    // Verify the data is actually in the database
    const boards = boardsRepo.listBoards(db);
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe("Test Board");

    const cols = columnsRepo.listColumns(db, boards[0].id);
    expect(cols).toHaveLength(2);

    const tasks = tasksRepo.listTasks(db, boards[0].id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Fix the thing");

    const taskLabels = labelsRepo.getTaskLabels(db, tasks[0].id);
    expect(taskLabels).toHaveLength(1);

    const subs = subtasksRepo.listSubtasks(db, tasks[0].id);
    expect(subs).toHaveLength(2);
  });

  it("imports empty boards array", () => {
    const result = importData(db, { boards: [] });
    expect(result.boardCount).toBe(0);
  });
});

describe("CLI: export/import roundtrip", () => {
  it("roundtrips data through export and import", () => {
    const sourceDb = createTestDb();
    seedBoard(sourceDb);
    const exported = exportAllData(sourceDb);

    const targetDb = createTestDb();
    importData(targetDb, exported as unknown as ImportData);
    const reExported = exportAllData(targetDb);

    // Compare structure (ignore timing differences)
    expect(reExported.boards).toHaveLength(exported.boards.length);
    expect(reExported.boards[0].name).toBe(exported.boards[0].name);
    expect(reExported.boards[0].columns).toHaveLength(exported.boards[0].columns.length);
    expect(reExported.boards[0].tasks).toHaveLength(exported.boards[0].tasks.length);
    expect(reExported.boards[0].labels).toHaveLength(exported.boards[0].labels.length);
  });
});

describe("CLI: users list", () => {
  let db: DB;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty list for no users", () => {
    const result = listUsers(db);
    expect(result).toEqual([]);
  });

  it("lists all users with id, name, email", () => {
    insertUser(db, "u1", "Alice", "alice@test.com");
    insertUser(db, "u2", "Bob", "bob@test.com");

    const result = listUsers(db);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "u1", name: "Alice", email: "alice@test.com" });
    expect(result[1]).toEqual({ id: "u2", name: "Bob", email: "bob@test.com" });
  });
});

describe("CLI: users reset-password", () => {
  let db: DB;

  beforeEach(() => {
    db = createTestDb();
    insertUser(db, "u1", "Alice", "alice@test.com");
  });

  it("resets password for existing user", () => {
    const ok = resetPassword(db, "alice@test.com", "newpass123");
    expect(ok).toBe(true);

    // Verify password hash was stored
    const user = db.select().from(users).where(eq(users.email, "alice@test.com")).get();
    expect(user?.password_hash).toBeTruthy();
    expect(user?.password_hash).toMatch(/^scrypt:/);
  });

  it("returns false for non-existent user", () => {
    const ok = resetPassword(db, "nobody@test.com", "newpass123");
    expect(ok).toBe(false);
  });
});

describe("CLI: hashPassword", () => {
  it("produces scrypt-prefixed hash", () => {
    const hash = hashPassword("test123");
    expect(hash).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("produces unique hashes for same password", () => {
    const h1 = hashPassword("test123");
    const h2 = hashPassword("test123");
    expect(h1).not.toBe(h2);
  });
});

describe("CLI: backup and restore", () => {
  it("backs up and restores a database file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tarmak-cli-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    const backupPath = path.join(tmpDir, "backup.db");

    try {
      // Create and seed a real database file
      const db = createDb(dbPath);
      migrateDb(db);
      boardsRepo.createBoard(db, "Backup Test");

      // Checkpoint WAL to ensure all data is in the main DB file
      db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);

      // Backup via fs.copyFileSync (same logic as backup.ts)
      fs.copyFileSync(dbPath, backupPath);
      expect(fs.existsSync(backupPath)).toBe(true);

      const stats = fs.statSync(backupPath);
      expect(stats.size).toBeGreaterThan(0);

      // Verify backup is valid SQLite
      const fd = fs.openSync(backupPath, "r");
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      const header = buf.toString("utf-8", 0, 15);
      expect(header).toBe("SQLite format 3");

      // Restore to a new path
      const restoredPath = path.join(tmpDir, "restored.db");
      fs.copyFileSync(backupPath, restoredPath);

      // Verify restored DB has the data
      const restoredDb = createDb(restoredPath);
      const boards = boardsRepo.listBoards(restoredDb);
      expect(boards).toHaveLength(1);
      expect(boards[0].name).toBe("Backup Test");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
