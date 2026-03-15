use anyhow::Context;
use rusqlite::Connection;

/// Run all migrations in order, skipping those already applied.
pub fn run_migrations(conn: &Connection) -> anyhow::Result<()> {
    // Enable WAL mode and foreign keys before anything else.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;",
    )
    .context("setting PRAGMAs")?;

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

    Ok(())
}

// ---------------------------------------------------------------------------
// V1 -- initial schema
// ---------------------------------------------------------------------------

fn v1(conn: &Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction().context("begin v1 transaction")?;
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
    let tx = conn.unchecked_transaction().context("begin v2 transaction")?;
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
    let tx = conn.unchecked_transaction().context("begin v3 transaction")?;
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
        assert_eq!(ver, 3);

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
        assert_eq!(ver, 3);
    }

    #[test]
    fn test_migration_v2_applies_cleanly() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 3);

        // Verify new column exists
        conn.execute_batch("SELECT password_hash FROM users LIMIT 0").unwrap();
        // Verify new table exists
        conn.execute_batch("SELECT 1 FROM api_keys LIMIT 0").unwrap();
        // Verify CRDT state table exists
        conn.execute_batch("SELECT 1 FROM board_crdt_state LIMIT 0").unwrap();
    }
}
