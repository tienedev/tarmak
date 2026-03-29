import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  repo_url: text("repo_url"),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
