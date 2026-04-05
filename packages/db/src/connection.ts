import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index";

export type DB = ReturnType<typeof createDb>;

export function createDb(path: string = ":memory:") {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

/**
 * Run all CREATE TABLE statements for in-memory / test databases.
 * Mirrors the Rust SQLite migrations v1-v10 exactly.
 */
export function migrateDb(db: DB) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      repo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      wip_limit INTEGER,
      color TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      assignee TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      due_date TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      locked_by TEXT,
      locked_at TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      avatar_url TEXT,
      is_agent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      password_hash TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS board_members (
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'viewer')),
      PRIMARY KEY (board_id, user_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS invite_links (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'viewer')),
      expires_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS task_labels (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      uploaded_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'url', 'enum', 'date')),
      config TEXT,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS task_custom_field_values (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      PRIMARY KEY (task_id, field_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS board_crdt_state (
      board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
      state BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      user_id TEXT NOT NULL REFERENCES users(id),
      branch_name TEXT,
      agent_profile_id TEXT,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // FTS5 virtual table for full-text search
  db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      entity_type, entity_id, board_id, task_id, content,
      tokenize='porter unicode61'
    )
  `);

  // FTS5 triggers for tasks
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
      DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
    END
  `);

  // FTS5 triggers for comments
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
      DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
      DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
    END
  `);

  // FTS5 triggers for subtasks
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS subtasks_ai AFTER INSERT ON subtasks BEGIN
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('subtask', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.title);
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS subtasks_au AFTER UPDATE ON subtasks BEGIN
      DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
      INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
      VALUES ('subtask', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.title);
    END
  `);

  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS subtasks_ad AFTER DELETE ON subtasks BEGIN
      DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
    END
  `);

  // Indexes
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_columns_board_id ON columns(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_board_id ON tasks(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_activity_board_id ON activity(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_comments_task_id ON comments(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_custom_fields_board ON custom_fields(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tcfv_task_id ON task_custom_field_values(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id)`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_board_name ON labels(board_id, name)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_attachments_board ON attachments(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_board ON agent_sessions(board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status)`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_running_per_task ON agent_sessions(task_id) WHERE status = 'running'`);
}
