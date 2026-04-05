import { agentRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const agentRouter = router({
  create: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        branchName: z.string().optional(),
        agentProfileId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return agentRepo.createAgentSession(ctx.db, {
        boardId: input.boardId,
        taskId: input.taskId,
        userId: ctx.user.id,
        branchName: input.branchName,
        agentProfileId: input.agentProfileId,
      });
    }),

  get: memberProcedure
    .input(z.object({ boardId: z.string(), id: z.string() }))
    .query(({ ctx, input }) => {
      const session = agentRepo.getAgentSession(ctx.db, input.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      return session;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.string().optional(),
        branchName: z.string().optional(),
        exitCode: z.number().int().optional(),
        log: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const session = agentRepo.updateAgentSession(ctx.db, input.id, {
        status: input.status,
        branchName: input.branchName,
        exitCode: input.exitCode,
        log: input.log,
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      return session;
    }),

  list: memberProcedure
    .input(
      z.object({
        boardId: z.string(),
        status: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return agentRepo.listBoardSessions(ctx.db, input.boardId, input.status);
    }),

  getRunning: protectedProcedure.input(z.object({ taskId: z.string() })).query(({ ctx, input }) => {
    return agentRepo.getRunningSession(ctx.db, input.taskId);
  }),
});
