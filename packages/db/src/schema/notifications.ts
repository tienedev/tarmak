import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { tasks } from "./tasks";
import { users } from "./users";

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  task_id: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});
