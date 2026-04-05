import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { labelsRepo } from "@tarmak/db";

export const labelRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(50),
        color: z.string().min(1).max(30),
      }),
    )
    .mutation(({ ctx, input }) => {
      return labelsRepo.createLabel(ctx.db, input.boardId, input.name, input.color);
    }),

  list: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => labelsRepo.listLabels(ctx.db, input.boardId)),

  update: protectedProcedure
    .input(
      z.object({
        labelId: z.string(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().min(1).max(30).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const updated = labelsRepo.updateLabel(ctx.db, input.labelId, {
        name: input.name,
        color: input.color,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ labelId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = labelsRepo.deleteLabel(ctx.db, input.labelId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  addToTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        labelId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      labelsRepo.attachLabel(ctx.db, input.taskId, input.labelId);
      return { success: true };
    }),

  removeFromTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        labelId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      labelsRepo.detachLabel(ctx.db, input.taskId, input.labelId);
      return { success: true };
    }),

  listForTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) => labelsRepo.getTaskLabels(ctx.db, input.taskId)),
});
