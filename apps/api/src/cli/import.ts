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
import { boards, columns, tasks, labels, taskLabels, subtasks, customFields, taskCustomFieldValues } from "@tarmak/db";

interface ImportData {
  boards: ImportBoard[];
}

interface ImportBoard {
  id: string;
  name: string;
  description?: string | null;
  repo_url?: string | null;
  created_at: string;
  updated_at: string;
  columns: ImportColumn[];
  tasks: ImportTask[];
  labels: ImportLabel[];
  custom_fields?: ImportCustomField[];
}

interface ImportColumn {
  id: string;
  board_id: string;
  name: string;
  position: number;
  wip_limit?: number | null;
  color?: string | null;
  archived: boolean;
}

interface ImportTask {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  description?: string | null;
  priority: string;
  assignee?: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  due_date?: string | null;
  archived: boolean;
  labels?: string[];
  subtasks?: ImportSubtask[];
  custom_field_values?: ImportFieldValue[];
}

interface ImportSubtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

interface ImportLabel {
  id: string;
  board_id: string;
  name: string;
  color: string;
  created_at: string;
}

interface ImportCustomField {
  id: string;
  board_id: string;
  name: string;
  field_type: string;
  config?: string | null;
  position: number;
}

interface ImportFieldValue {
  task_id: string;
  field_id: string;
  value: string;
}

function importData(db: DB, data: ImportData) {
  return db.transaction((tx) => {
    return importDataInner(tx as unknown as DB, data);
  });
}

function importDataInner(db: DB, data: ImportData) {
  let boardCount = 0;
  let columnCount = 0;
  let taskCount = 0;
  let labelCount = 0;

  for (const board of data.boards) {
    db.insert(boards)
      .values({
        id: board.id,
        name: board.name,
        description: board.description ?? null,
        repo_url: board.repo_url ?? null,
        created_at: board.created_at,
        updated_at: board.updated_at,
      })
      .run();
    boardCount++;

    // Import labels first (tasks may reference them)
    for (const label of board.labels) {
      db.insert(labels)
        .values({
          id: label.id,
          board_id: board.id,
          name: label.name,
          color: label.color,
          created_at: label.created_at,
        })
        .run();
      labelCount++;
    }

    // Import custom fields
    if (board.custom_fields) {
      for (const field of board.custom_fields) {
        db.insert(customFields)
          .values({
            id: field.id,
            board_id: board.id,
            name: field.name,
            field_type: field.field_type,
            config: field.config ?? null,
            position: field.position,
          })
          .run();
      }
    }

    // Import columns
    for (const col of board.columns) {
      db.insert(columns)
        .values({
          id: col.id,
          board_id: board.id,
          name: col.name,
          position: col.position,
          wip_limit: col.wip_limit ?? null,
          color: col.color ?? null,
          archived: col.archived,
        })
        .run();
      columnCount++;
    }

    // Import tasks
    for (const task of board.tasks) {
      db.insert(tasks)
        .values({
          id: task.id,
          board_id: board.id,
          column_id: task.column_id,
          title: task.title,
          description: task.description ?? null,
          priority: task.priority,
          assignee: task.assignee ?? null,
          position: task.position,
          created_at: task.created_at,
          updated_at: task.updated_at,
          due_date: task.due_date ?? null,
          archived: task.archived,
        })
        .run();
      taskCount++;

      // Import task-label associations
      if (task.labels) {
        for (const labelId of task.labels) {
          db.insert(taskLabels)
            .values({ task_id: task.id, label_id: labelId })
            .run();
        }
      }

      // Import subtasks
      if (task.subtasks) {
        for (const st of task.subtasks) {
          db.insert(subtasks)
            .values({
              id: st.id,
              task_id: task.id,
              title: st.title,
              completed: st.completed,
              position: st.position,
              created_at: st.created_at,
            })
            .run();
        }
      }

      // Import custom field values
      if (task.custom_field_values) {
        for (const fv of task.custom_field_values) {
          db.insert(taskCustomFieldValues)
            .values({
              task_id: task.id,
              field_id: fv.field_id,
              value: fv.value,
            })
            .run();
        }
      }
    }
  }

  return { boardCount, columnCount, taskCount, labelCount };
}


export async function runImport(args: string[]): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? "./tarmak.db";
  const srcPath = args[0];

  if (!srcPath) {
    console.error("Usage: tarmak import <path>");
    process.exit(1);
  }

  const resolvedSrc = path.resolve(srcPath);

  if (!fs.existsSync(resolvedSrc)) {
    console.error(`Import file not found: ${resolvedSrc}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedSrc, "utf-8");
  let data: ImportData;

  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Invalid JSON file");
    process.exit(1);
  }

  if (!data.boards || !Array.isArray(data.boards)) {
    console.error("Invalid import format: expected { boards: [...] }");
    process.exit(1);
  }

  const db = createDb(dbPath);
  const result = importData(db, data);

  console.log(
    `Imported ${result.boardCount} board(s), ${result.columnCount} column(s), ${result.taskCount} task(s), ${result.labelCount} label(s)`,
  );
}

// Exported for testing
export { importData, type ImportData };
