import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { tasks } from "./tasks";
import { users } from "./users";

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  task_id: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  details: text("details"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});
