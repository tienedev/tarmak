import { subtasksRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const subtaskRouter = router({
  create: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) => {
      return subtasksRepo.createSubtask(ctx.db, input.taskId, input.title);
    }),

  list: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => subtasksRepo.listSubtasks(ctx.db, input.taskId)),

  update: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        subtaskId: z.string(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(({ ctx, input }) => {
      const subtask = subtasksRepo.updateSubtask(ctx.db, input.subtaskId, input.title);
      if (!subtask) throw new TRPCError({ code: "NOT_FOUND" });
      return subtask;
    }),

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), subtaskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = subtasksRepo.deleteSubtask(ctx.db, input.subtaskId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  toggle: writerProcedure
    .input(z.object({ boardId: z.string(), subtaskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const subtask = subtasksRepo.toggleSubtask(ctx.db, input.subtaskId);
      if (!subtask) throw new TRPCError({ code: "NOT_FOUND" });
      return subtask;
    }),

  move: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
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
