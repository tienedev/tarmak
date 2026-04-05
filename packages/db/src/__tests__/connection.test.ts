import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../connection";
import { agentSessions } from "../schema/agent";
import { boards } from "../schema/boards";
import { columns } from "../schema/columns";
import { comments } from "../schema/comments";
import { labels, taskLabels } from "../schema/labels";
import { notifications } from "../schema/notifications";
import { subtasks } from "../schema/subtasks";
import { tasks } from "../schema/tasks";
import { boardMembers, users } from "../schema/users";

describe("createDb", () => {
  it("creates in-memory database", () => {
    const db = createDb();
    expect(db).toBeDefined();
  });

  it("can insert and query a board after migration", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards)
      .values({
        id: "test-1",
        name: "Test Board",
      })
      .run();

    const result = db.select().from(boards).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Board");
  });

  it("supports board with all optional fields", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards)
      .values({
        id: "b-full",
        name: "Full Board",
        description: "A board with everything",
        repo_url: "https://github.com/example/repo",
      })
      .run();

    const result = db.select().from(boards).where(eq(boards.id, "b-full")).all();
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("A board with everything");
    expect(result[0].repo_url).toBe("https://github.com/example/repo");
    expect(result[0].created_at).toBeDefined();
    expect(result[0].updated_at).toBeDefined();
  });

  it("can insert columns with foreign key to boards", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();

    const result = db.select().from(columns).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Todo");
    expect(result[0].archived).toBe(false);
  });

  it("can insert tasks with foreign keys", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks)
      .values({
        id: "t1",
        board_id: "b1",
        column_id: "c1",
        title: "My Task",
        priority: "high",
      })
      .run();

    const result = db.select().from(tasks).all();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("My Task");
    expect(result[0].priority).toBe("high");
    expect(result[0].archived).toBe(false);
  });

  it("can insert users and board members", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(users).values({ id: "u1", name: "Alice", email: "alice@test.com" }).run();

    db.insert(boardMembers).values({ board_id: "b1", user_id: "u1", role: "owner" }).run();

    const result = db.select().from(users).all();
    expect(result).toHaveLength(1);
    expect(result[0].is_agent).toBe(false);
  });

  it("can insert labels and task labels", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks).values({ id: "t1", board_id: "b1", column_id: "c1", title: "Task" }).run();
    db.insert(labels).values({ id: "l1", board_id: "b1", name: "Bug", color: "#ff0000" }).run();
    db.insert(taskLabels).values({ task_id: "t1", label_id: "l1" }).run();

    const result = db.select().from(taskLabels).all();
    expect(result).toHaveLength(1);
  });

  it("can insert comments", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks).values({ id: "t1", board_id: "b1", column_id: "c1", title: "Task" }).run();
    db.insert(users).values({ id: "u1", name: "Alice", email: "alice@test.com" }).run();
    db.insert(comments)
      .values({ id: "cmt1", task_id: "t1", user_id: "u1", content: "Hello" })
      .run();

    const result = db.select().from(comments).all();
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello");
  });

  it("can insert subtasks", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks).values({ id: "t1", board_id: "b1", column_id: "c1", title: "Task" }).run();
    db.insert(subtasks).values({ id: "st1", task_id: "t1", title: "Sub 1" }).run();

    const result = db.select().from(subtasks).all();
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(false);
  });

  it("can insert notifications", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(users).values({ id: "u1", name: "Alice", email: "alice@test.com" }).run();
    db.insert(notifications)
      .values({
        id: "n1",
        user_id: "u1",
        board_id: "b1",
        type: "task_assigned",
        title: "You were assigned",
      })
      .run();

    const result = db.select().from(notifications).all();
    expect(result).toHaveLength(1);
    expect(result[0].read).toBe(false);
  });

  it("can insert agent sessions", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks).values({ id: "t1", board_id: "b1", column_id: "c1", title: "Task" }).run();
    db.insert(users)
      .values({ id: "u1", name: "Agent", email: "agent@test.com", is_agent: true })
      .run();
    db.insert(agentSessions)
      .values({
        id: "as1",
        board_id: "b1",
        task_id: "t1",
        user_id: "u1",
      })
      .run();

    const result = db.select().from(agentSessions).all();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("running");
  });

  it("enforces cascade delete from boards", () => {
    const db = createDb();
    migrateDb(db);

    db.insert(boards).values({ id: "b1", name: "Board" }).run();
    db.insert(columns).values({ id: "c1", board_id: "b1", name: "Todo", position: 0 }).run();
    db.insert(tasks).values({ id: "t1", board_id: "b1", column_id: "c1", title: "Task" }).run();

    // Delete the board — should cascade to columns and tasks
    db.delete(boards).where(eq(boards.id, "b1")).run();

    expect(db.select().from(columns).all()).toHaveLength(0);
    expect(db.select().from(tasks).all()).toHaveLength(0);
  });
});
