import { sql } from "drizzle-orm";
import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";

export const boardCrdtState = sqliteTable("board_crdt_state", {
  board_id: text("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  state: blob("state", { mode: "buffer" }).notNull(),
  updated_at: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
