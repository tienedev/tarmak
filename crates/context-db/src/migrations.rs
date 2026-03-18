use rusqlite::Connection;

pub fn run_migrations(conn: &mut Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS executions (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL,
            task_id     TEXT,
            command     TEXT NOT NULL,
            exit_code   INTEGER,
            tier        TEXT NOT NULL,
            duration_ms INTEGER,
            summary     TEXT,
            errors      TEXT,
            files_touched TEXT,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS causal_chains (
            id              TEXT PRIMARY KEY,
            trigger_file    TEXT NOT NULL,
            trigger_error   TEXT,
            trigger_command TEXT NOT NULL DEFAULT '',
            resolution_file TEXT NOT NULL,
            attempts        INTEGER DEFAULT 1,
            successes       INTEGER DEFAULT 1,
            confidence      REAL DEFAULT 0.5,
            last_verified   TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            UNIQUE(trigger_file, trigger_command, resolution_file)
        );

        CREATE TABLE IF NOT EXISTS project_facts (
            id          TEXT PRIMARY KEY,
            fact        TEXT NOT NULL,
            citation    TEXT NOT NULL,
            source      TEXT NOT NULL,
            confidence  REAL DEFAULT 1.0,
            verified_at TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS archived_memories (
            id            TEXT PRIMARY KEY,
            source_table  TEXT NOT NULL,
            data          TEXT NOT NULL,
            archived_at   TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
            fact, citation, content=project_facts, content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS project_facts_ai AFTER INSERT ON project_facts BEGIN
            INSERT INTO memory_fts(rowid, fact, citation)
            VALUES (new.rowid, new.fact, new.citation);
        END;

        CREATE TRIGGER IF NOT EXISTS project_facts_ad AFTER DELETE ON project_facts BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
            VALUES ('delete', old.rowid, old.fact, old.citation);
        END;

        CREATE TRIGGER IF NOT EXISTS project_facts_au AFTER UPDATE ON project_facts BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, fact, citation)
            VALUES ('delete', old.rowid, old.fact, old.citation);
            INSERT INTO memory_fts(rowid, fact, citation)
            VALUES (new.rowid, new.fact, new.citation);
        END;",
    )?;
    Ok(())
}
