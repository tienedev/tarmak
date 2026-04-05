import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { archiveRepo } from "@tarmak/db";

export const archiveRouter = router({
  archiveTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = archiveRepo.archiveTask(ctx.db, input.taskId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  unarchiveTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = archiveRepo.unarchiveTask(ctx.db, input.taskId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  listArchivedTasks: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => {
      return archiveRepo.listArchivedTasks(ctx.db, input.boardId);
    }),

  listArchivedColumns: protectedProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => {
      return archiveRepo.listArchivedColumns(ctx.db, input.boardId);
    }),
});
