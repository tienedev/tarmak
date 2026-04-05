import { describe, expect, it, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDb, migrateDb, type DB } from "@tarmak/db";
import { sql } from "drizzle-orm";
import { createMcpServer } from "../mcp/server";

function createTestDb(): DB {
  const db = createDb();
  migrateDb(db);
  db.run(
    sql`INSERT INTO users (id, name, email) VALUES ('u1', 'Alice', 'alice@test.com')`,
  );
  return db;
}

function seedBoard(db: DB) {
  // Create a board
  db.run(
    sql`INSERT INTO boards (id, name, description, created_at, updated_at) VALUES ('b1', 'Test Board', 'A test board', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
  );
  // Create columns
  db.run(
    sql`INSERT INTO columns (id, board_id, name, position, archived) VALUES ('col1', 'b1', 'Todo', 1, 0)`,
  );
  db.run(
    sql`INSERT INTO columns (id, board_id, name, position, archived) VALUES ('col2', 'b1', 'In Progress', 2, 0)`,
  );
  db.run(
    sql`INSERT INTO columns (id, board_id, name, position, archived) VALUES ('col3', 'b1', 'Done', 3, 0)`,
  );
  // Create labels
  db.run(
    sql`INSERT INTO labels (id, board_id, name, color, created_at) VALUES ('lbl1', 'b1', 'bug', '#ff0000', '2025-01-01T00:00:00Z')`,
  );
  db.run(
    sql`INSERT INTO labels (id, board_id, name, color, created_at) VALUES ('lbl2', 'b1', 'feature', '#00ff00', '2025-01-01T00:00:00Z')`,
  );
  // Create tasks
  db.run(
    sql`INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at, due_date, archived) VALUES ('t1', 'b1', 'col1', 'Fix login bug', 'Login is broken', 'high', 'Alice', 1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2025-06-01', 0)`,
  );
  db.run(
    sql`INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at, due_date, archived) VALUES ('t2', 'b1', 'col1', 'Add dark mode', 'Theme support', 'medium', NULL, 2, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', NULL, 0)`,
  );
  db.run(
    sql`INSERT INTO tasks (id, board_id, column_id, title, description, priority, assignee, position, created_at, updated_at, due_date, archived) VALUES ('t3', 'b1', 'col2', 'Write tests', 'Need more tests', 'urgent', 'Alice', 1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2024-12-01', 0)`,
  );
  // Assign labels
  db.run(sql`INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'lbl1')`);
  db.run(sql`INSERT INTO task_labels (task_id, label_id) VALUES ('t3', 'lbl2')`);
  // Create subtasks
  db.run(
    sql`INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES ('st1', 't1', 'Reproduce issue', 1, 1, '2025-01-01T00:00:00Z')`,
  );
  db.run(
    sql`INSERT INTO subtasks (id, task_id, title, completed, position, created_at) VALUES ('st2', 't1', 'Write fix', 0, 2, '2025-01-01T00:00:00Z')`,
  );
}

async function createTestClient(db: DB) {
  const mcpServer = createMcpServer(db);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcpServer.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, mcpServer };
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? "";
}

// ============================================================
// board_query
// ============================================================
describe("board_query", () => {
  let db: DB;
  let client: Client;

  beforeEach(async () => {
    db = createTestDb();
    seedBoard(db);
    const ctx = await createTestClient(db);
    client = ctx.client;
  });

  it("lists all boards", async () => {
    const result = await callTool(client, "board_query", { board_id: "list" });
    const boards = JSON.parse(result);
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe("Test Board");
  });

  it("returns board info", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "info",
    });
    const info = JSON.parse(result);
    expect(info.name).toBe("Test Board");
  });

  it("returns tasks in KBF format", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "tasks",
      format: "kbf",
    });
    expect(result).toContain("#task@v2:");
    expect(result).toContain("Fix login bug");
    expect(result).toContain("Add dark mode");
    expect(result).toContain("Write tests");
  });

  it("returns tasks in JSON format", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "tasks",
      format: "json",
    });
    const tasks = JSON.parse(result);
    expect(tasks).toHaveLength(3);
  });

  it("returns columns in KBF format", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "columns",
      format: "kbf",
    });
    expect(result).toContain("#column@v1:");
    expect(result).toContain("Todo");
    expect(result).toContain("In Progress");
  });

  it("returns labels", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "labels",
      format: "json",
    });
    const labels = JSON.parse(result);
    expect(labels).toHaveLength(2);
    expect(labels.map((l: { name: string }) => l.name)).toContain("bug");
  });

  it("returns subtasks for a task", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "subtasks",
      task_id: "t1",
    });
    const subs = JSON.parse(result);
    expect(subs).toHaveLength(2);
  });

  it("requires task_id for subtasks scope", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "subtasks",
    });
    expect(result).toContain("task_id required");
  });

  it("searches with FTS5", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "search",
      query: "login",
    });
    const results = JSON.parse(result);
    expect(results.length).toBeGreaterThan(0);
  });

  it("requires query for search scope", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "search",
    });
    expect(result).toContain("query required");
  });

  it("returns all in KBF format", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "all",
      format: "kbf",
    });
    expect(result).toContain("Test Board");
    expect(result).toContain("#column@v1:");
    expect(result).toContain("#task@v2:");
    expect(result).toContain("#label@v1:");
  });

  it("returns all in JSON format", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "b1",
      scope: "all",
      format: "json",
    });
    const data = JSON.parse(result);
    expect(data.board.name).toBe("Test Board");
    expect(data.columns).toHaveLength(3);
    expect(data.tasks).toHaveLength(3);
    expect(data.labels).toHaveLength(2);
  });

  it("returns error for nonexistent board", async () => {
    const result = await callTool(client, "board_query", {
      board_id: "nonexistent",
      scope: "info",
    });
    expect(result).toContain("not found");
  });
});

// ============================================================
// board_mutate
// ============================================================
describe("board_mutate", () => {
  let db: DB;
  let client: Client;

  beforeEach(async () => {
    db = createTestDb();
    seedBoard(db);
    const ctx = await createTestClient(db);
    client = ctx.client;
  });

  it("creates a task", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_task",
      data: { column_id: "col1", title: "New task" },
    });
    expect(result).toContain("created task");
  });

  it("updates a task", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "update_task",
      data: { task_id: "t1", title: "Updated title" },
    });
    expect(result).toContain("updated task t1");
  });

  it("moves a task", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "move_task",
      data: { task_id: "t1", column_id: "col2", position: 1 },
    });
    expect(result).toContain("moved task t1");
  });

  it("deletes a task", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "delete_task",
      data: { task_id: "t1" },
    });
    expect(result).toContain("deleted task t1");
  });

  it("archives and unarchives a task", async () => {
    let result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "archive_task",
      data: { task_id: "t1" },
    });
    expect(result).toContain("archived task t1");

    result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "unarchive_task",
      data: { task_id: "t1" },
    });
    expect(result).toContain("unarchived task t1");
  });

  it("creates a column", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_column",
      data: { name: "Review" },
    });
    expect(result).toContain("created column");
  });

  it("updates a column", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "update_column",
      data: { column_id: "col1", name: "Backlog" },
    });
    expect(result).toContain("updated column col1");
  });

  it("deletes a column", async () => {
    // Delete a column with no tasks first
    db.run(
      sql`INSERT INTO columns (id, board_id, name, position, archived) VALUES ('col4', 'b1', 'Empty', 4, 0)`,
    );
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "delete_column",
      data: { column_id: "col4" },
    });
    expect(result).toContain("deleted column col4");
  });

  it("creates a label", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_label",
      data: { name: "enhancement", color: "#0000ff" },
    });
    expect(result).toContain("created label");
  });

  it("updates a label", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "update_label",
      data: { label_id: "lbl1", name: "critical-bug" },
    });
    expect(result).toContain("updated label lbl1");
  });

  it("deletes a label", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "delete_label",
      data: { label_id: "lbl1" },
    });
    expect(result).toContain("deleted label");
  });

  it("adds and removes label from task", async () => {
    let result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "add_label_to_task",
      data: { task_id: "t2", label_id: "lbl2" },
    });
    expect(result).toContain("added label lbl2 to task t2");

    result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "remove_label_from_task",
      data: { task_id: "t2", label_id: "lbl2" },
    });
    expect(result).toContain("removed label lbl2 from task t2");
  });

  it("creates a comment", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_comment",
      data: { task_id: "t1", user_id: "u1", content: "Looking into this" },
    });
    expect(result).toContain("created comment");
  });

  it("creates a subtask", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_subtask",
      data: { task_id: "t1", title: "Deploy fix" },
    });
    expect(result).toContain("created subtask");
  });

  it("toggles a subtask", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "toggle_subtask",
      data: { subtask_id: "st2" },
    });
    expect(result).toContain("toggled subtask st2");
    expect(result).toContain("completed=true");
  });

  it("creates a custom field", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_custom_field",
      data: { name: "Story Points", field_type: "number" },
    });
    expect(result).toContain("created custom field");
  });

  it("creates a board", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_board",
      data: { name: "New Board" },
    });
    expect(result).toContain("created board");
  });

  it("updates a board", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "update_board",
      data: { name: "Renamed Board" },
    });
    expect(result).toContain("updated board b1");
  });

  it("returns error for unknown action", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "unknown_action",
      data: {},
    });
    expect(result).toContain("unknown action");
  });

  it("returns error for missing data fields", async () => {
    const result = await callTool(client, "board_mutate", {
      board_id: "b1",
      action: "create_task",
      data: {},
    });
    expect(result).toContain("error:");
  });
});

// ============================================================
// board_sync
// ============================================================
describe("board_sync", () => {
  let db: DB;
  let client: Client;

  beforeEach(async () => {
    db = createTestDb();
    seedBoard(db);
    const ctx = await createTestClient(db);
    client = ctx.client;
  });

  it("returns full board state without delta", async () => {
    const result = await callTool(client, "board_sync", { board_id: "b1" });
    expect(result).toContain("Test Board");
    expect(result).toContain("#column@v1:");
    expect(result).toContain("#task@v2:");
    expect(result).toContain("#label@v1:");
  });

  it("applies update delta", async () => {
    const result = await callTool(client, "board_sync", {
      board_id: "b1",
      delta: ">t1.title=Fixed login bug",
    });
    expect(result).toContain("Applied:");
    expect(result).toContain("updated t1.title");
    expect(result).toContain("Fixed login bug");
  });

  it("applies create delta", async () => {
    const result = await callTool(client, "board_sync", {
      board_id: "b1",
      delta: ">col1|New task from delta|desc||+",
    });
    expect(result).toContain("Applied:");
    expect(result).toContain("created task");
    expect(result).toContain("New task from delta");
  });

  it("applies delete delta", async () => {
    const result = await callTool(client, "board_sync", {
      board_id: "b1",
      delta: ">t2-",
    });
    expect(result).toContain("Applied:");
    expect(result).toContain("deleted t2");
    // t2 should not appear in KBF output
    expect(result).not.toContain("Add dark mode");
  });

  it("applies multiple deltas", async () => {
    const delta = ">t1.title=Bug fixed\n>t2.pri=high";
    const result = await callTool(client, "board_sync", {
      board_id: "b1",
      delta,
    });
    expect(result).toContain("updated t1.title");
    expect(result).toContain("updated t2.pri");
    expect(result).toContain("Bug fixed");
  });

  it("returns error for nonexistent board", async () => {
    const result = await callTool(client, "board_sync", { board_id: "bad" });
    expect(result).toContain("not found");
  });

  it("returns error for invalid delta syntax", async () => {
    const result = await callTool(client, "board_sync", {
      board_id: "b1",
      delta: "invalid delta",
    });
    expect(result).toContain("Error parsing delta");
  });
});

// ============================================================
// board_ask
// ============================================================
describe("board_ask", () => {
  let db: DB;
  let client: Client;

  beforeEach(async () => {
    db = createTestDb();
    seedBoard(db);
    const ctx = await createTestClient(db);
    client = ctx.client;
  });

  it("finds overdue tasks", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "What tasks are overdue?",
    });
    // t3 has due_date 2024-12-01 which is in the past
    expect(result).toContain("Write tests");
  });

  it("finds unassigned tasks", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Show unassigned tasks",
    });
    expect(result).toContain("Add dark mode");
    // t1 and t3 are assigned, should not appear
    expect(result).not.toContain("Fix login bug");
  });

  it("finds tasks with no labels", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Tasks with no labels",
    });
    // t2 has no labels
    expect(result).toContain("Add dark mode");
  });

  it("returns board stats", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Show me stats",
    });
    expect(result).toContain("Total tasks: 3");
    expect(result).toContain("Todo:");
    expect(result).toContain("In Progress:");
  });

  it("returns stats in JSON format", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Show statistics",
      format: "json",
    });
    const stats = JSON.parse(result);
    expect(stats.total_tasks).toBe(3);
    expect(stats.by_priority).toBeDefined();
  });

  it("finds high priority tasks", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Show high priority and urgent tasks",
    });
    expect(result).toContain("Fix login bug");
    expect(result).toContain("Write tests");
  });

  it("finds tasks with no due date", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Tasks with no due date",
    });
    expect(result).toContain("Add dark mode");
  });

  it("falls back to FTS5 search", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "login",
    });
    // Should find t1 via FTS5
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns error for nonexistent board", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "bad",
      question: "anything",
    });
    expect(result).toContain("not found");
  });

  it("supports KBF output format", async () => {
    const result = await callTool(client, "board_ask", {
      board_id: "b1",
      question: "Show unassigned tasks",
      format: "kbf",
    });
    expect(result).toContain("#task@v2:");
  });
});

// ============================================================
// Server creation
// ============================================================
describe("MCP server creation", () => {
  it("lists available tools", async () => {
    const db = createTestDb();
    const { client } = await createTestClient(db);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("board_query");
    expect(names).toContain("board_mutate");
    expect(names).toContain("board_sync");
    expect(names).toContain("board_ask");
  });
});
