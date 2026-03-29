import { router } from "./context";
import { boardRouter } from "./procedures/boards";
import { columnRouter } from "./procedures/columns";

export const appRouter = router({
  board: boardRouter,
  column: columnRouter,
});

export type AppRouter = typeof appRouter;
