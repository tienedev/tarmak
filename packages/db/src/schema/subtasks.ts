import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tasks } from "./tasks";

export const subtasks = sqliteTable("subtasks", {
  id: text("id").primaryKey(),
  task_id: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull().default(0),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});
