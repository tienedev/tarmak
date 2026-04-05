import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { memberProcedure, writerProcedure } from "../middleware/roles";
import { attachmentsRepo } from "@tarmak/db";

export const attachmentRouter = router({
  list: memberProcedure
    .input(z.object({ boardId: z.string(), taskId: z.string() }))
    .query(({ ctx, input }) => attachmentsRepo.listAttachments(ctx.db, input.taskId)),

  get: memberProcedure
    .input(z.object({ boardId: z.string(), attachmentId: z.string() }))
    .query(({ ctx, input }) => {
      const attachment = attachmentsRepo.getAttachment(ctx.db, input.attachmentId);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      return attachment;
    }),

  delete: writerProcedure
    .input(z.object({ boardId: z.string(), attachmentId: z.string() }))
    .mutation(({ ctx, input }) => {
      const deleted = attachmentsRepo.deleteAttachment(ctx.db, input.attachmentId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});
