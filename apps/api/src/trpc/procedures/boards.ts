import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { boardsRepo } from "@tarmak/db";

export const boardRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const board = boardsRepo.createBoard(ctx.db, input.name, input.description);
      boardsRepo.addMember(ctx.db, board.id, ctx.user.id, "owner");
      return board;
    }),

  list: protectedProcedure.query(({ ctx }) => boardsRepo.listBoards(ctx.db)),

  get: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => {
      const board = boardsRepo.getBoard(ctx.db, input.boardId);
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });
      return board;
    }),

  update: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        repoUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const board = boardsRepo.updateBoard(ctx.db, input.boardId, {
        name: input.name,
        description: input.description,
        repo_url: input.repoUrl,
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });
      return board;
    }),

  delete: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = boardsRepo.deleteBoard(ctx.db, input.boardId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  duplicate: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        newName: z.string().min(1).max(100),
        includeTasks: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) => {
      return boardsRepo.duplicateBoard(
        ctx.db,
        input.boardId,
        input.newName,
        input.includeTasks,
        ctx.user.id,
      );
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        userId: z.string(),
        role: z.enum(["owner", "member", "viewer"]),
      }),
    )
    .mutation(({ ctx, input }) => {
      boardsRepo.addMember(ctx.db, input.boardId, input.userId, input.role);
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const removed = boardsRepo.removeMember(ctx.db, input.boardId, input.userId);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  listMembers: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => boardsRepo.listMembers(ctx.db, input.boardId)),
});
