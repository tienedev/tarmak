import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { commentsRepo } from "@tarmak/db";

export const commentRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      return commentsRepo.createComment(ctx.db, input.taskId, ctx.user.id, input.content);
    }),

  list: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) => commentsRepo.listComments(ctx.db, input.taskId)),

  update: protectedProcedure
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      const comment = commentsRepo.updateComment(ctx.db, input.commentId, input.content);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      return comment;
    }),

  delete: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = commentsRepo.deleteComment(ctx.db, input.commentId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
