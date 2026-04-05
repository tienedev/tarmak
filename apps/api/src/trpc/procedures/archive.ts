import { archiveRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const archiveRouter = router({
  archiveTask: writerProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = archiveRepo.archiveTask(ctx.db, input.taskId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  unarchiveTask: writerProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = archiveRepo.unarchiveTask(ctx.db, input.taskId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  listArchivedTasks: memberProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => {
      return archiveRepo.listArchivedTasks(ctx.db, input.boardId);
    }),

  listArchivedColumns: memberProcedure
    .input(z.object({ boardId: z.string() }))
    .query(({ ctx, input }) => {
      return archiveRepo.listArchivedColumns(ctx.db, input.boardId);
    }),
});
