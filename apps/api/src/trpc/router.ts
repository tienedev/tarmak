import { router } from "./context";
import { boardRouter } from "./procedures/boards";
import { columnRouter } from "./procedures/columns";
import { taskRouter } from "./procedures/tasks";

export const appRouter = router({
  board: boardRouter,
  column: columnRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;
