import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { notificationsRepo } from "@tarmak/db";

export const notificationRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().optional(),
          unreadOnly: z.boolean().optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return notificationsRepo.listNotifications(
        ctx.db,
        ctx.user.id,
        input?.limit,
        input?.unreadOnly,
        input?.offset,
      );
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = notificationsRepo.markRead(ctx.db, input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(({ ctx }) => {
    const count = notificationsRepo.markAllRead(ctx.db, ctx.user.id);
    return { count };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const ok = notificationsRepo.deleteNotification(ctx.db, input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  unreadCount: protectedProcedure.query(({ ctx }) => {
    return { count: notificationsRepo.getUnreadCount(ctx.db, ctx.user.id) };
  }),
});
