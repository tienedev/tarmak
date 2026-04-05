import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";
import { tasks } from "./tasks";

export const customFields = sqliteTable("custom_fields", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  field_type: text("field_type").notNull(),
  config: text("config"),
  position: integer("position").notNull().default(0),
});

export const taskCustomFieldValues = sqliteTable(
  "task_custom_field_values",
  {
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    field_id: text("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.task_id, table.field_id] })],
);
