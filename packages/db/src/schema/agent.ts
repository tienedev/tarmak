import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { tasks } from "./tasks";
import { users } from "./users";

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey().notNull(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  task_id: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  branch_name: text("branch_name"),
  agent_profile_id: text("agent_profile_id"),
  started_at: text("started_at"),
  finished_at: text("finished_at"),
  exit_code: integer("exit_code"),
  log: text("log"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
});
