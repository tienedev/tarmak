import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { subtasksRepo } from "@tarmak/db";

export const subtaskRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) => {
      return subtasksRepo.createSubtask(ctx.db, input.taskId, input.title);
    }),

  list: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) => subtasksRepo.listSubtasks(ctx.db, input.taskId)),

  update: protectedProcedure
    .input(
      z.object({
        subtaskId: z.string(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) => {
      const subtask = subtasksRepo.updateSubtask(ctx.db, input.subtaskId, input.title);
      if (!subtask) throw new TRPCError({ code: "NOT_FOUND" });
      return subtask;
    }),

  delete: protectedProcedure
    .input(z.object({ subtaskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = subtasksRepo.deleteSubtask(ctx.db, input.subtaskId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  toggle: protectedProcedure
    .input(z.object({ subtaskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const subtask = subtasksRepo.toggleSubtask(ctx.db, input.subtaskId);
      if (!subtask) throw new TRPCError({ code: "NOT_FOUND" });
      return subtask;
    }),

  move: protectedProcedure
    .input(
      z.object({
        subtaskId: z.string(),
        position: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) => {
      const moved = subtasksRepo.moveSubtask(ctx.db, input.subtaskId, input.position);
      if (!moved) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
