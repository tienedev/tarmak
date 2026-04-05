import fs from "node:fs";
import path from "node:path";
import {
  createDb,
  boardsRepo,
  columnsRepo,
  tasksRepo,
  labelsRepo,
  subtasksRepo,
  customFieldsRepo,
  type DB,
} from "@tarmak/db";

function exportAllData(db: DB) {
  const allBoards = boardsRepo.listBoards(db);

  const boards = allBoards.map((board) => {
    const cols = columnsRepo.listColumns(db, board.id);
    const allTasks = tasksRepo.listTasks(db, board.id);
    const boardLabels = labelsRepo.listLabels(db, board.id);
    const fields = customFieldsRepo.listCustomFields(db, board.id);

    const tasksWithRelations = allTasks.map((task) => {
      const taskLabels = labelsRepo.getTaskLabels(db, task.id);
      const taskSubtasks = subtasksRepo.listSubtasks(db, task.id);
      const taskFieldValues = customFieldsRepo.getFieldValues(db, task.id);

      return {
        ...task,
        labels: taskLabels.map((l) => l.id),
        subtasks: taskSubtasks,
        custom_field_values: taskFieldValues,
      };
    });

    return {
      ...board,
      columns: cols,
      tasks: tasksWithRelations,
      labels: boardLabels,
      custom_fields: fields,
    };
  });

  return { boards };
}

export async function runExport(args: string[]): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  let outputPath: string | null = null;

  // Parse --output <path> flag
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      break;
    }
  }

  const db = createDb(dbPath);
  const data = exportAllData(db);
  const json = JSON.stringify(data, null, 2);

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.writeFileSync(resolved, json, "utf-8");
    console.log(`Exported ${data.boards.length} board(s) to ${resolved}`);
  } else {
    console.log(json);
  }
}

// Exported for testing
export { exportAllData };
