import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { attachmentsRepo } from "@tarmak/db";

export const attachmentRouter = router({
  list: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) => attachmentsRepo.listAttachments(ctx.db, input.taskId)),

  get: protectedProcedure
    .input(z.object({ attachmentId: z.string() }))
    .query(({ ctx, input }) => {
      const attachment = attachmentsRepo.getAttachment(ctx.db, input.attachmentId);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      return attachment;
    }),

  delete: protectedProcedure
    .input(z.object({ attachmentId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = attachmentsRepo.deleteAttachment(ctx.db, input.attachmentId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
