import { sql } from "drizzle-orm";
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { tasks } from "./tasks";

export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const taskLabels = sqliteTable(
  "task_labels",
  {
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    label_id: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.task_id, table.label_id] })],
);
