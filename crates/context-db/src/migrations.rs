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
        END;

        CREATE TABLE IF NOT EXISTS execution_summaries (
            id INTEGER PRIMARY KEY,
            command TEXT NOT NULL UNIQUE,
            total_runs INTEGER NOT NULL,
            success_rate REAL NOT NULL,
            avg_duration_ms INTEGER NOT NULL,
            last_error TEXT,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_exec_summaries_command
            ON execution_summaries(command);

        CREATE TABLE IF NOT EXISTS session_reports (
            id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL,
            board_id TEXT,
            tasks_completed INTEGER NOT NULL DEFAULT 0,
            tasks_escalated INTEGER NOT NULL DEFAULT 0,
            commands_run INTEGER NOT NULL DEFAULT 0,
            chains_created INTEGER NOT NULL DEFAULT 0,
            duration_seconds INTEGER,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    Ok(())
}
