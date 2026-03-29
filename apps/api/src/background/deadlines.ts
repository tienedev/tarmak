import { and, isNotNull, eq, lt } from "drizzle-orm";
import type { DB } from "@tarmak/db";
import { tasks, notificationsRepo } from "@tarmak/db";
import type { NotificationBroadcaster } from "../notifications/broadcaster";
import { logger } from "../logger";

export function startDeadlineChecker(
  db: DB,
  broadcaster: NotificationBroadcaster,
  intervalMs: number = 3_600_000,
): NodeJS.Timeout {
  return setInterval(() => {
    try {
      checkDeadlines(db, broadcaster);
    } catch (err) {
      logger.error({ err }, "Deadline check failed");
    }
  }, intervalMs);
}

export function checkDeadlines(
  db: DB,
  broadcaster: NotificationBroadcaster,
): void {
  const now = new Date().toISOString();

  // Find non-archived tasks with overdue due_date and an assignee
  const overdue = db
    .select({
      id: tasks.id,
      board_id: tasks.board_id,
      title: tasks.title,
      assignee: tasks.assignee,
      due_date: tasks.due_date,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.archived, false),
        isNotNull(tasks.assignee),
        isNotNull(tasks.due_date),
        lt(tasks.due_date, now),
      ),
    )
    .all();

  for (const task of overdue) {
    // assignee is guaranteed non-null by the query filter
    const assignee = task.assignee!;

    // Deduplicate: skip if we already sent a deadline notification for this task+user
    if (notificationsRepo.hasDeadlineNotification(db, task.id, assignee)) {
      continue;
    }

    try {
      const notification = notificationsRepo.createNotification(db, {
        userId: assignee,
        boardId: task.board_id,
        taskId: task.id,
        type: "deadline_overdue",
        title: `Task "${task.title}" is overdue`,
      });

      broadcaster.send({
        userId: assignee,
        type: "deadline_overdue",
        title: notification.title,
        boardId: task.board_id,
        taskId: task.id,
      });
    } catch (err) {
      logger.error({ err, taskId: task.id }, "Failed to create deadline notification");
    }
  }
}
