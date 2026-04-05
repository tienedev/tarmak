import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { customFieldsRepo } from "@tarmak/db";

export const customFieldRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(100),
        fieldType: z.string().min(1),
        config: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return customFieldsRepo.createCustomField(
        ctx.db,
        input.boardId,
        input.name,
        input.fieldType,
        input.config,
      );
    }),

  list: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => customFieldsRepo.listCustomFields(ctx.db, input.boardId)),

  update: protectedProcedure
    .input(
      z.object({
        fieldId: z.string(),
        name: z.string().min(1).max(100).optional(),
        config: z.string().optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const updated = customFieldsRepo.updateCustomField(ctx.db, input.fieldId, {
        name: input.name,
        config: input.config,
        position: input.position,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ fieldId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = customFieldsRepo.deleteCustomField(ctx.db, input.fieldId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  setTaskValue: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        fieldId: z.string(),
        value: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      customFieldsRepo.setFieldValue(ctx.db, input.taskId, input.fieldId, input.value);
      return { success: true };
    }),

  getTaskValues: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) => customFieldsRepo.getFieldValues(ctx.db, input.taskId)),
});
