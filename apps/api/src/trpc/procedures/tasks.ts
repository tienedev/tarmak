import { tasksRepo } from "@tarmak/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";

export const taskRouter = router({
  create: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        columnId: z.string(),
        title: z.string().min(1).max(500),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return tasksRepo.createTask(ctx.db, {
        boardId: input.boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assignee: input.assignee,
      });
    }),

  get: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => {
      const task = tasksRepo.getTaskWithRelations(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      return task;
    }),

  list: memberProcedure
    .input(
      z.object({
        boardId: z.string(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return tasksRepo.listTasks(ctx.db, input.boardId, input.limit, input.offset);
    }),

  update: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        due_date: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { taskId, boardId: _, ...data } = input;
      const task = tasksRepo.updateTask(ctx.db, taskId, data);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      return task;
    }),

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = tasksRepo.deleteTask(ctx.db, input.taskId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  move: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        columnId: z.string(),
        position: z.number().int().min(0),
      }),
    )
    .mutation(({ ctx, input }) => {
      const task = tasksRepo.moveTask(ctx.db, input.taskId, input.columnId, input.position);
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      return task;
    }),

  duplicate: writerProcedure
    .input(
      z.object({
        taskId: z.string(),
        boardId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return tasksRepo.duplicateTask(ctx.db, input.taskId, input.boardId);
    }),

  claim: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        agentId: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const result = tasksRepo.claimTask(ctx.db, input.boardId, input.agentId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "No claimable task found" });
      return result;
    }),

  release: writerProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .mutation(({ ctx, input }) => {
      tasksRepo.releaseTask(ctx.db, input.taskId);
      return { success: true };
    }),
});
