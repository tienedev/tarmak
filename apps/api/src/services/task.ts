import type { DB } from "@tarmak/db";
import { tasksRepo, columnsRepo } from "@tarmak/db";

export class TaskService {
  constructor(private db: DB) {}

  claimTask(boardId: string, agentId: string) {
    return tasksRepo.claimTask(this.db, boardId, agentId);
  }

  releaseTask(taskId: string) {
    return tasksRepo.releaseTask(this.db, taskId);
  }

  completeTask(taskId: string) {
    const task = tasksRepo.getTask(this.db, taskId);
    if (!task) throw new Error("Task not found");
    const cols = columnsRepo.listColumns(this.db, task.board_id);
    const lastColumn = cols.sort((a, b) => b.position - a.position)[0];
    if (lastColumn) {
      tasksRepo.moveTask(this.db, taskId, lastColumn.id, 0);
    }
  }

  decompose(boardId: string, tasks: DecomposeInput[]) {
    validateDag(tasks);
    const cols = columnsRepo.listColumns(this.db, boardId);
    const firstColumn = cols.sort((a, b) => a.position - b.position)[0];
    if (!firstColumn) throw new Error("Board has no columns");

    const created = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const task = tasksRepo.createTask(this.db, {
        boardId,
        columnId: firstColumn.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
      });
      created.push(task);
    }
    return created;
  }
}

interface DecomposeInput {
  title: string;
  description?: string;
  priority?: string;
  depends_on?: number[];
}

function validateDag(tasks: DecomposeInput[]): void {
  const n = tasks.length;
  const inDegree = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (const dep of tasks[i].depends_on ?? []) {
      if (dep < 0 || dep >= n) throw new Error(`Invalid dependency index: ${dep}`);
      adj[dep].push(i);
      inDegree[i]++;
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (visited !== n) throw new Error("Cycle detected in task dependencies");
}
