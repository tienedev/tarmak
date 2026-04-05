import { columnsRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const columnRouter = router({
  create: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        name: z.string().min(1).max(100),
        wipLimit: z.number().int().positive().optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return columnsRepo.createColumn(
        ctx.db,
        input.boardId,
        input.name,
        input.wipLimit,
        input.color,
      );
    }),

  list: memberProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => columnsRepo.listColumns(ctx.db, input.boardId)),

  update: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
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

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = columnsRepo.deleteColumn(ctx.db, input.columnId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  move: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        columnId: z.string(),
        position: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) => {
      const moved = columnsRepo.moveColumn(ctx.db, input.columnId, input.position);
      if (!moved) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  archive: writerProcedure
    .input(z.object({ boardId: z.string(), columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      columnsRepo.archiveColumn(ctx.db, input.columnId);
      return { success: true };
    }),

  unarchive: writerProcedure
    .input(z.object({ boardId: z.string(), columnId: z.string() }))
    .mutation(({ ctx, input }) => {
      columnsRepo.unarchiveColumn(ctx.db, input.columnId);
      return { success: true };
    }),
});
