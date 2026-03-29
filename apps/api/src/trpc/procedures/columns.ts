import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { columnsRepo } from "@tarmak/db";

export const columnRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(100),
        wipLimit: z.number().int().positive().optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return columnsRepo.createColumn(ctx.db, input.boardId, input.name, input.wipLimit, input.color);
    }),

  list: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => columnsRepo.listColumns(ctx.db, input.boardId)),

  update: protectedProcedure
    .input(
      z.object({
        columnId: z.string(),
        name: z.string().min(1).max(100).optional(),
        wipLimit: z.number().int().positive().nullable().optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const updated = columnsRepo.updateColumn(ctx.db, input.columnId, {
        name: input.name,
        wipLimit: input.wipLimit ?? undefined,
        color: input.color ?? undefined,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = columnsRepo.deleteColumn(ctx.db, input.columnId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  move: protectedProcedure
    .input(
      z.object({
        columnId: z.string(),
        position: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) => {
      const moved = columnsRepo.moveColumn(ctx.db, input.columnId, input.position);
      if (!moved) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  archive: protectedProcedure
    .input(z.object({ columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      columnsRepo.archiveColumn(ctx.db, input.columnId);
      return { success: true };
    }),

  unarchive: protectedProcedure
    .input(z.object({ columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      columnsRepo.unarchiveColumn(ctx.db, input.columnId);
      return { success: true };
    }),
});
