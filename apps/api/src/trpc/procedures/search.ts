import { searchRepo } from "@tarmak/db";
import { z } from "zod";
import { router } from "../context";
import { memberProcedure } from "../middleware/roles";

export const searchRouter = router({
  query: memberProcedure
    .input(
      z.object({
        boardId: z.string(),
        query: z.string().min(1),
        includeArchived: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      return searchRepo.search(ctx.db, input.boardId, input.query, {
        includeArchived: input.includeArchived,
      });
    }),
});
