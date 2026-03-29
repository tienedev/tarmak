import { describe, expect, it } from "vitest";
import { createDb, migrateDb, columnsRepo } from "@tarmak/db";
import { router, publicProcedure } from "../trpc/context";
import { TaskService } from "../services/task";
import { BoardService } from "../services/board";
import type { Context } from "../trpc/context";

function createTestContext(): Context {
  const db = createDb();
  migrateDb(db);
  return { db, user: { id: "u1", name: "Test", email: "test@test.com" } };
}

describe("tRPC context", () => {
  it("creates a basic router", async () => {
    const appRouter = router({
      hello: publicProcedure.query(() => "world"),
    });
    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.hello();
    expect(result).toBe("world");
  });
});

describe("TaskService", () => {
  it("decomposes tasks with DAG validation", () => {
    const ctx = createTestContext();
    const boardService = new BoardService(ctx.db);
    const board = boardService.createBoard("Test");

    // Need a column first
    columnsRepo.createColumn(ctx.db, board.id, "Backlog");

    const taskService = new TaskService(ctx.db);
    const tasks = taskService.decompose(board.id, [
      { title: "Task A" },
      { title: "Task B", depends_on: [0] },
    ]);
    expect(tasks).toHaveLength(2);
  });

  it("rejects cycles in decompose", () => {
    const ctx = createTestContext();
    const taskService = new TaskService(ctx.db);
    const boardService = new BoardService(ctx.db);
    const board = boardService.createBoard("Test");
    columnsRepo.createColumn(ctx.db, board.id, "Backlog");

    expect(() =>
      taskService.decompose(board.id, [
        { title: "A", depends_on: [1] },
        { title: "B", depends_on: [0] },
      ])
    ).toThrow("Cycle detected");
  });
});

describe("BoardService", () => {
  it("creates and retrieves a board with columns", () => {
    const ctx = createTestContext();
    const boardService = new BoardService(ctx.db);
    const board = boardService.createBoard("Test Board", "A description");
    expect(board.name).toBe("Test Board");

    columnsRepo.createColumn(ctx.db, board.id, "Todo");
    columnsRepo.createColumn(ctx.db, board.id, "Done");

    const result = boardService.getBoardWithColumns(board.id);
    expect(result).not.toBeNull();
    expect(result!.columns).toHaveLength(2);
  });
});
