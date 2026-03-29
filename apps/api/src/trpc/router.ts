import { router } from "./context";
import { boardRouter } from "./procedures/boards";
import { columnRouter } from "./procedures/columns";
import { taskRouter } from "./procedures/tasks";
import { labelRouter } from "./procedures/labels";
import { commentRouter } from "./procedures/comments";
import { subtaskRouter } from "./procedures/subtasks";
import { attachmentRouter } from "./procedures/attachments";
import { customFieldRouter } from "./procedures/custom-fields";

export const appRouter = router({
  board: boardRouter,
  column: columnRouter,
  task: taskRouter,
  label: labelRouter,
  comment: commentRouter,
  subtask: subtaskRouter,
  attachment: attachmentRouter,
  customField: customFieldRouter,
});

export type AppRouter = typeof appRouter;
