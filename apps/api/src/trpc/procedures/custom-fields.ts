import { customFieldsRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, ownerProcedure, writerProcedure } from "../middleware/roles";

export const customFieldRouter = router({
  create: ownerProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(100),
        fieldType: z.enum(["text", "number", "url", "enum", "date"]),
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

  list: memberProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => customFieldsRepo.listCustomFields(ctx.db, input.boardId)),

  update: ownerProcedure
    .input(
      z.object({
        boardId: z.string(),
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

  delete: ownerProcedure
    .input(z.object({ boardId: z.string(), fieldId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = customFieldsRepo.deleteCustomField(ctx.db, input.fieldId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  setTaskValue: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        fieldId: z.string(),
        value: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      customFieldsRepo.setFieldValue(ctx.db, input.taskId, input.fieldId, input.value);
      return { success: true };
    }),

  getTaskValues: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => customFieldsRepo.getFieldValues(ctx.db, input.taskId)),
});
