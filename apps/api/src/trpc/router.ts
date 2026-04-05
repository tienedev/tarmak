import { router } from "./context";
import { activityRouter } from "./procedures/activity";
import { agentRouter } from "./procedures/agent";
import { archiveRouter } from "./procedures/archive";
import { attachmentRouter } from "./procedures/attachments";
import { boardRouter } from "./procedures/boards";
import { columnRouter } from "./procedures/columns";
import { commentRouter } from "./procedures/comments";
import { customFieldRouter } from "./procedures/custom-fields";
import { labelRouter } from "./procedures/labels";
import { notificationRouter } from "./procedures/notifications";
import { searchRouter } from "./procedures/search";
import { subtaskRouter } from "./procedures/subtasks";
import { taskRouter } from "./procedures/tasks";

export const appRouter = router({
  board: boardRouter,
  column: columnRouter,
  task: taskRouter,
  label: labelRouter,
  comment: commentRouter,
  subtask: subtaskRouter,
  attachment: attachmentRouter,
  customField: customFieldRouter,
  notification: notificationRouter,
  search: searchRouter,
  archive: archiveRouter,
  agent: agentRouter,
  activity: activityRouter,
});

export type AppRouter = typeof appRouter;
