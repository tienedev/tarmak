import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";

export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  wip_limit: integer("wip_limit"),
  color: text("color"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});
