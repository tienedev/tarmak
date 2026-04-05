import { labelsRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const labelRouter = router({
  create: writerProcedure
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

  list: memberProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => labelsRepo.listLabels(ctx.db, input.boardId)),

  update: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
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

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), labelId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = labelsRepo.deleteLabel(ctx.db, input.labelId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  addToTask: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        labelId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      labelsRepo.attachLabel(ctx.db, input.taskId, input.labelId);
      return { success: true };
    }),

  removeFromTask: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        labelId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      labelsRepo.detachLabel(ctx.db, input.taskId, input.labelId);
      return { success: true };
    }),

  listForTask: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => labelsRepo.getTaskLabels(ctx.db, input.taskId)),
});
