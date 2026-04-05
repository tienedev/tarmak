import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boards } from "./boards";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  avatar_url: text("avatar_url"),
  is_agent: integer("is_agent", { mode: "boolean" }).notNull().default(false),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  password_hash: text("password_hash"),
});

export const boardMembers = sqliteTable(
  "board_members",
  {
    board_id: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
  },
  (table) => [primaryKey({ columns: [table.board_id, table.user_id] })],
);

export const inviteLinks = sqliteTable("invite_links", {
  id: text("id").primaryKey(),
  board_id: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("member"),
  expires_at: text("expires_at"),
  created_by: text("created_by")
    .notNull()
    .references(() => users.id),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token_hash: text("token_hash").notNull().unique(),
  expires_at: text("expires_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key_hash: text("key_hash").notNull().unique(),
  key_prefix: text("key_prefix").notNull(),
  created_at: text("created_at").notNull().default(sql`(datetime('now'))`),
  last_used_at: text("last_used_at"),
});
