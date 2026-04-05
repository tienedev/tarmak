import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { router } from "../context";
import { protectedProcedure } from "../middleware/auth";
import { activity } from "@tarmak/db";

export const activityRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        boardId: z.string(),
        limit: z.number().int().positive().max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(activity)
        .where(eq(activity.board_id, input.boardId))
        .orderBy(desc(activity.created_at))
        .limit(input.limit ?? 50)
        .all();
    }),
});
