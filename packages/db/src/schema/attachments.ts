import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tasks } from "./tasks";
import { boards } from "./boards";
import { users } from "./users";

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  task_id: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime_type: text("mime_type").notNull(),
  size_bytes: integer("size_bytes").notNull(),
  storage_key: text("storage_key").notNull(),
  uploaded_by: text("uploaded_by").references(() => users.id),
  created_at: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
