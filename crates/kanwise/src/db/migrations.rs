use anyhow::Context;
use rusqlite::Connection;

/// Run all migrations in order, skipping those already applied.
pub fn run_migrations(conn: &Connection) -> anyhow::Result<()> {
    // Bootstrap the version-tracking table.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
             version INTEGER PRIMARY KEY
         );",
    )
    .context("creating schema_version table")?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        v1(conn).context("applying migration v1")?;
    }

    if current < 2 {
        v2(conn).context("applying migration v2")?;
    }

    if current < 3 {
        v3(conn).context("applying migration v3")?;
    }

    if current < 4 {
        v4(conn).context("applying migration v4")?;
    }

    if current < 5 {
        v5(conn).context("applying migration v5")?;
    }

    if current < 6 {
        v6(conn).context("applying migration v6")?;
    }

    if current < 7 {
        v7(conn).context("applying migration v7")?;
    }

    if current < 8 {
        v8(conn).context("applying migration v8")?;
    }

    if current < 9 {
        v9(conn).context("applying migration v9")?;
    }

    if current < 10 {
        v10(conn).context("applying migration v10")?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// V1 -- initial schema
// ---------------------------------------------------------------------------

fn v1(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v1 transaction")?;
    tx.execute_batch(
        "
        -- Boards
        CREATE TABLE IF NOT EXISTS boards (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        -- Columns
        CREATE TABLE IF NOT EXISTS columns (
            id        TEXT PRIMARY KEY,
            board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            name      TEXT NOT NULL,
            position  INTEGER NOT NULL DEFAULT 0,
            wip_limit INTEGER,
            color     TEXT
        );

        -- Tasks
        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT PRIMARY KEY,
            board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            column_id   TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            description TEXT,
            priority    TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
            assignee    TEXT,
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        -- Custom fields
        CREATE TABLE IF NOT EXISTS custom_fields (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'url', 'enum', 'date')),
            config     TEXT,
            position   INTEGER NOT NULL DEFAULT 0
        );

        -- Task custom field values
        CREATE TABLE IF NOT EXISTS task_custom_field_values (
            task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
            value    TEXT NOT NULL,
            PRIMARY KEY (task_id, field_id)
        );

        -- Users
        CREATE TABLE IF NOT EXISTS users (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            is_agent   INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        -- Board members
        CREATE TABLE IF NOT EXISTS board_members (
            board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role     TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('owner', 'member', 'viewer')),
            PRIMARY KEY (board_id, user_id)
        );

        -- Invite links
        CREATE TABLE IF NOT EXISTS invite_links (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            token      TEXT NOT NULL UNIQUE,
            role       TEXT NOT NULL DEFAULT 'member'
                       CHECK (role IN ('owner', 'member', 'viewer')),
            expires_at TEXT,
            created_by TEXT NOT NULL REFERENCES users(id)
        );

        -- Comments
        CREATE TABLE IF NOT EXISTS comments (
            id         TEXT PRIMARY KEY,
            task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id    TEXT NOT NULL REFERENCES users(id),
            content    TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- Activity log
        CREATE TABLE IF NOT EXISTS activity (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            user_id    TEXT NOT NULL REFERENCES users(id),
            action     TEXT NOT NULL,
            details    TEXT,
            created_at TEXT NOT NULL
        );

        -- Sessions
        CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_tasks_board_id      ON tasks(board_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_column_id     ON tasks(column_id);
        CREATE INDEX IF NOT EXISTS idx_columns_board_id    ON columns(board_id);
        CREATE INDEX IF NOT EXISTS idx_activity_board_id   ON activity(board_id);
        CREATE INDEX IF NOT EXISTS idx_comments_task_id    ON comments(task_id);
        CREATE INDEX IF NOT EXISTS idx_custom_fields_board ON custom_fields(board_id);
        CREATE INDEX IF NOT EXISTS idx_tcfv_task_id        ON task_custom_field_values(task_id);

        -- Record migration
        INSERT INTO schema_version (version) VALUES (1);
        ",
    )
    .context("v1 migration")?;
    tx.commit().context("commit v1 migration")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// V2 -- auth tables (password_hash + api_keys)
// ---------------------------------------------------------------------------

fn v2(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v2 transaction")?;
    tx.execute_batch(
        "
        -- Add password_hash to users (nullable for existing users)
        ALTER TABLE users ADD COLUMN password_hash TEXT;

        -- API keys table
        CREATE TABLE IF NOT EXISTS api_keys (
            id           TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name         TEXT NOT NULL,
            key_hash     TEXT NOT NULL UNIQUE,
            key_prefix   TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            last_used_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

        -- Backfill: assign all existing users as owner of all existing boards
        -- so pre-v2 boards remain accessible after permissions are enforced.
        INSERT OR IGNORE INTO board_members (board_id, user_id, role)
        SELECT b.id, u.id, 'owner'
        FROM boards b, users u;

        -- Record migration
        INSERT INTO schema_version (version) VALUES (2);
        ",
    )
    .context("v2 migration")?;
    tx.commit().context("commit v2 migration")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// V3 -- CRDT state persistence
// ---------------------------------------------------------------------------

fn v3(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v3 transaction")?;
    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS board_crdt_state (
            board_id   TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
            state      BLOB NOT NULL,
            updated_at TEXT NOT NULL
        );

        -- Record migration
        INSERT INTO schema_version (version) VALUES (3);
        ",
    )
    .context("v3 migration")?;
    tx.commit().context("commit v3 migration")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// V4 -- labels, task_labels, subtasks + due_date on tasks
// ---------------------------------------------------------------------------

fn v4(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v4 transaction")?;
    tx.execute_batch(
        "
        -- Labels (per board, reusable across tasks)
        CREATE TABLE IF NOT EXISTS labels (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            color      TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_board_name ON labels(board_id, name);

        -- Many-to-many: tasks <-> labels
        CREATE TABLE IF NOT EXISTS task_labels (
            task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

        -- Subtasks
        CREATE TABLE IF NOT EXISTS subtasks (
            id         TEXT PRIMARY KEY,
            task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            title      TEXT NOT NULL,
            completed  INTEGER NOT NULL DEFAULT 0,
            position   INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

        -- Due date on tasks
        ALTER TABLE tasks ADD COLUMN due_date TEXT;

        -- Record migration
        INSERT INTO schema_version (version) VALUES (4);
        ",
    )
    .context("v4 migration")?;
    tx.commit().context("commit v4 migration")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// V5 -- FTS5 search index with triggers + backfill
// ---------------------------------------------------------------------------

fn v5(conn: &Connection) -> anyhow::Result<()> {
    // FTS5 virtual tables cannot be created inside a transaction on all SQLite
    // builds, so we create the virtual table outside the transaction first.
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
            entity_type,
            entity_id,
            board_id,
            task_id,
            content,
            tokenize='porter unicode61'
        );",
    )
    .context("v5: create FTS5 virtual table")?;

    let tx = conn
        .unchecked_transaction()
        .context("begin v5 transaction")?;
    tx.execute_batch(
        "
        -- Triggers to keep index in sync

        -- Tasks: title + description
        CREATE TRIGGER IF NOT EXISTS search_idx_task_insert AFTER INSERT ON tasks BEGIN
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS search_idx_task_update AFTER UPDATE ON tasks BEGIN
            DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS search_idx_task_delete AFTER DELETE ON tasks BEGIN
            DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
        END;

        -- Comments
        CREATE TRIGGER IF NOT EXISTS search_idx_comment_insert AFTER INSERT ON comments BEGIN
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('comment', NEW.id,
                (SELECT board_id FROM tasks WHERE id = NEW.task_id),
                NEW.task_id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS search_idx_comment_delete AFTER DELETE ON comments BEGIN
            DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
        END;

        -- Subtasks
        CREATE TRIGGER IF NOT EXISTS search_idx_subtask_insert AFTER INSERT ON subtasks BEGIN
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('subtask', NEW.id,
                (SELECT board_id FROM tasks WHERE id = NEW.task_id),
                NEW.task_id, NEW.title);
        END;

        CREATE TRIGGER IF NOT EXISTS search_idx_subtask_update AFTER UPDATE ON subtasks BEGIN
            DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('subtask', NEW.id,
                (SELECT board_id FROM tasks WHERE id = NEW.task_id),
                NEW.task_id, NEW.title);
        END;

        CREATE TRIGGER IF NOT EXISTS search_idx_subtask_delete AFTER DELETE ON subtasks BEGIN
            DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
        END;

        -- Backfill existing data
        INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
        SELECT 'task', id, board_id, id, title || ' ' || COALESCE(description, '') FROM tasks;

        INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
        SELECT 'comment', c.id, t.board_id, c.task_id, c.content
        FROM comments c INNER JOIN tasks t ON t.id = c.task_id;

        INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
        SELECT 'subtask', s.id, t.board_id, s.task_id, s.title
        FROM subtasks s INNER JOIN tasks t ON t.id = s.task_id;

        -- Record migration
        INSERT INTO schema_version (version) VALUES (5);
        ",
    )
    .context("v5 migration")?;
    tx.commit().context("commit v5 migration")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// V6 -- archive support + attachments
// ---------------------------------------------------------------------------

fn v6(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v6 transaction")?;
    tx.execute_batch(
        "
        -- Archive support
        ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE columns ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

        -- Attachments
        CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            storage_key TEXT NOT NULL,
            uploaded_by TEXT REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_attachments_task ON attachments(task_id);
        CREATE INDEX idx_attachments_board ON attachments(board_id);

        INSERT INTO schema_version (version) VALUES (6);
        ",
    )?;
    tx.commit().context("commit v6")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// V7 -- updated_at on comments + FTS5 update trigger for comments
// ---------------------------------------------------------------------------

fn v7(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v7 transaction")?;
    tx.execute_batch(
        "
        ALTER TABLE comments ADD COLUMN updated_at TEXT;

        CREATE TRIGGER IF NOT EXISTS search_idx_comment_update AFTER UPDATE ON comments BEGIN
            DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
            INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
            VALUES ('comment', NEW.id,
                (SELECT board_id FROM tasks WHERE id = NEW.task_id),
                NEW.task_id, NEW.content);
        END;

        INSERT INTO schema_version (version) VALUES (7);
        ",
    )
    .context("v7 migration")?;
    tx.commit().context("commit v7")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// V8 -- notifications table
// ---------------------------------------------------------------------------

fn v8(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v8 transaction")?;
    tx.execute_batch(
        "
        CREATE TABLE notifications (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
            type       TEXT NOT NULL,
            title      TEXT NOT NULL,
            body       TEXT,
            read       INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE INDEX idx_notifications_user_unread
            ON notifications(user_id, read, created_at);

        INSERT INTO schema_version (version) VALUES (8);
        ",
    )
    .context("v8 migration")?;
    tx.commit().context("commit v8")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// V9 -- task locking for agent coordination
// ---------------------------------------------------------------------------

fn v9(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v9 transaction")?;
    tx.execute_batch(
        "
        ALTER TABLE tasks ADD COLUMN locked_by TEXT;
        ALTER TABLE tasks ADD COLUMN locked_at TEXT;

        INSERT INTO schema_version (version) VALUES (9);
        ",
    )
    .context("v9 migration")?;
    tx.commit().context("commit v9")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// V10 -- agent_sessions table + repo_url on boards
// ---------------------------------------------------------------------------

fn v10(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn
        .unchecked_transaction()
        .context("begin v10 transaction")?;
    tx.execute_batch(
        "
        ALTER TABLE boards ADD COLUMN repo_url TEXT;

        CREATE TABLE agent_sessions (
            id              TEXT PRIMARY KEY NOT NULL,
            board_id        TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
            task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            status          TEXT NOT NULL DEFAULT 'running',
            user_id         TEXT NOT NULL REFERENCES users(id),
            branch_name     TEXT,
            agent_profile_id TEXT,
            started_at      TEXT,
            finished_at     TEXT,
            exit_code       INTEGER,
            log             TEXT,
            created_at      TEXT NOT NULL
        );

        CREATE INDEX idx_agent_sessions_board ON agent_sessions(board_id);
        CREATE INDEX idx_agent_sessions_task ON agent_sessions(task_id);
        CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
        CREATE UNIQUE INDEX idx_agent_sessions_running_per_task
            ON agent_sessions(task_id) WHERE status = 'running';

        INSERT INTO schema_version (version) VALUES (10);
        ",
    )
    .context("v10 migration")?;
    tx.commit().context("commit v10")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_apply_cleanly() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Verify the schema_version was recorded.
        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 10);

        // Spot-check a few tables exist by running innocuous queries.
        conn.execute_batch("SELECT 1 FROM boards LIMIT 0").unwrap();
        conn.execute_batch("SELECT 1 FROM columns LIMIT 0").unwrap();
        conn.execute_batch("SELECT 1 FROM tasks LIMIT 0").unwrap();
        conn.execute_batch("SELECT 1 FROM custom_fields LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM users LIMIT 0").unwrap();
        conn.execute_batch("SELECT 1 FROM board_members LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM invite_links LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM comments LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM activity LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM sessions LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM board_crdt_state LIMIT 0")
            .unwrap();
        // v4 tables
        conn.execute_batch("SELECT 1 FROM labels LIMIT 0").unwrap();
        conn.execute_batch("SELECT 1 FROM task_labels LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM subtasks LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT due_date FROM tasks LIMIT 0")
            .unwrap();
        // v5 FTS5 table
        conn.execute_batch("SELECT 1 FROM search_index LIMIT 0")
            .unwrap();
        // v6 archive + attachments
        conn.execute_batch("SELECT archived FROM tasks LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT archived FROM columns LIMIT 0")
            .unwrap();
        conn.execute_batch("SELECT 1 FROM attachments LIMIT 0")
            .unwrap();
        // v7 updated_at on comments
        conn.execute_batch("SELECT updated_at FROM comments LIMIT 0")
            .unwrap();
        // v8 notifications
        conn.execute_batch("SELECT id, user_id, type, title, read FROM notifications LIMIT 0")
            .unwrap();
        // v9 task locking
        conn.execute_batch("SELECT locked_by, locked_at FROM tasks LIMIT 0")
            .unwrap();
        // v10 agent_sessions + repo_url
        conn.execute("SELECT id, board_id, task_id, status FROM agent_sessions LIMIT 0", [])
            .unwrap();
        conn.execute("SELECT repo_url FROM boards LIMIT 0", [])
            .unwrap();
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Running again must not fail.
        run_migrations(&conn).unwrap();

        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 10);
    }

    #[test]
    fn test_migration_v2_applies_cleanly() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 10);

        // Verify new column exists
        conn.execute_batch("SELECT password_hash FROM users LIMIT 0")
            .unwrap();
        // Verify new table exists
        conn.execute_batch("SELECT 1 FROM api_keys LIMIT 0")
            .unwrap();
        // Verify CRDT state table exists
        conn.execute_batch("SELECT 1 FROM board_crdt_state LIMIT 0")
            .unwrap();
    }
}
