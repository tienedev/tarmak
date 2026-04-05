import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";
import { commentsRepo, comments } from "@tarmak/db";

export const commentRouter = router({
  create: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        taskId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      return commentsRepo.createComment(ctx.db, input.taskId, ctx.user.id, input.content);
    }),

  list: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => commentsRepo.listComments(ctx.db, input.taskId)),

  update: writerProcedure
    .input(
      z.object({
        boardId: z.string(),
        commentId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      // Check comment ownership: only the author or board owner can edit
      const existing = ctx.db
        .select({ user_id: comments.user_id })
        .from(comments)
        .where(eq(comments.id, input.commentId))
        .get();
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.user_id !== ctx.user.id && ctx.boardRole !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit another user's comment" });
      }

      const comment = commentsRepo.updateComment(ctx.db, input.commentId, input.content);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      return comment;
    }),

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), commentId: z.string() }))
    .mutation(({ ctx, input }) => {
      // Check comment ownership: only the author or board owner can delete
      const existing = ctx.db
        .select({ user_id: comments.user_id })
        .from(comments)
        .where(eq(comments.id, input.commentId))
        .get();
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.user_id !== ctx.user.id && ctx.boardRole !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete another user's comment" });
      }

      const deleted = commentsRepo.deleteComment(ctx.db, input.commentId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
