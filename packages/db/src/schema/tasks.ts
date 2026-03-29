import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { boards } from "./boards";
import { columns } from "./columns";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  column_id: text("column_id")
    .notNull()
    .references(() => columns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  assignee: text("assignee"),
  position: integer("position").notNull().default(0),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
  due_date: text("due_date"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  locked_by: text("locked_by"),
  locked_at: text("locked_at"),
});
