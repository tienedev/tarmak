import { describe, expect, it } from "vitest";
import { createDb, migrateDb, columnsRepo, boardsRepo } from "@tarmak/db";
import { router, publicProcedure } from "../trpc/context";
import { protectedProcedure } from "../trpc/middleware/auth";
import { requireRole } from "../trpc/middleware/roles";
import { TaskService } from "../services/task";
import { BoardService } from "../services/board";
import type { Context } from "../trpc/context";
import { z } from "zod";

function createTestContext(user?: Context["user"] | null): Context {
  const db = createDb();
  migrateDb(db);
  return {
    db,
    user: user === null ? null : (user ?? { id: "u1", name: "Test", email: "test@test.com" }),
  };
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

describe("protectedProcedure", () => {
  it("rejects unauthenticated requests", async () => {
    const appRouter = router({
      secret: protectedProcedure.query(() => "hidden"),
    });
    const caller = appRouter.createCaller(createTestContext(null));
    await expect(caller.secret()).rejects.toThrow("UNAUTHORIZED");
  });

  it("allows authenticated requests", async () => {
    const appRouter = router({
      secret: protectedProcedure.query(() => "hidden"),
    });
    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.secret();
    expect(result).toBe("hidden");
  });
});

describe("requireRole", () => {
  function setupBoardWithMember(role: string) {
    const ctx = createTestContext();
    const board = boardsRepo.createBoard(ctx.db, "Test Board");

    // Seed user and add as board member
    ctx.db.run(
      require("drizzle-orm").sql`INSERT INTO users (id, name, email) VALUES (${ctx.user!.id}, ${ctx.user!.name}, ${ctx.user!.email})`,
    );
    boardsRepo.addMember(ctx.db, board.id, ctx.user!.id, role);

    return { ctx, board };
  }

  it("rejects member when owner required", async () => {
    const { ctx, board } = setupBoardWithMember("member");

    const appRouter = router({
      ownerOnly: publicProcedure
        .input(z.object({ boardId: z.string() }))
        .use(requireRole("owner"))
        .query(() => "ok"),
    });

    const caller = appRouter.createCaller(ctx);
    await expect(caller.ownerOnly({ boardId: board.id })).rejects.toThrow("Requires owner role");
  });

  it("allows owner when member required", async () => {
    const { ctx, board } = setupBoardWithMember("owner");

    const appRouter = router({
      memberAction: publicProcedure
        .input(z.object({ boardId: z.string() }))
        .use(requireRole("member"))
        .query(() => "ok"),
    });

    const caller = appRouter.createCaller(ctx);
    const result = await caller.memberAction({ boardId: board.id });
    expect(result).toBe("ok");
  });

  it("rejects non-member", async () => {
    const ctx = createTestContext();
    const board = boardsRepo.createBoard(ctx.db, "Test Board");
    ctx.db.run(
      require("drizzle-orm").sql`INSERT INTO users (id, name, email) VALUES (${ctx.user!.id}, ${ctx.user!.name}, ${ctx.user!.email})`,
    );

    const appRouter = router({
      memberOnly: publicProcedure
        .input(z.object({ boardId: z.string() }))
        .use(requireRole("viewer"))
        .query(() => "ok"),
    });

    const caller = appRouter.createCaller(ctx);
    await expect(caller.memberOnly({ boardId: board.id })).rejects.toThrow("Not a board member");
  });
});
