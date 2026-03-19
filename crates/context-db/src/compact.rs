use crate::db::Db;
use anyhow::Result;

#[derive(Debug, Default)]
pub struct CompactionStats {
    pub chains_merged: u32,
    pub chains_pruned: u32,
    pub executions_summarized: u32,
}

/// Merge causal chains that have the same trigger_error + resolution_file + trigger_command
/// but different trigger_file. Keep the one with highest confidence, delete the rest.
pub async fn merge_duplicates(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        let deleted = conn.execute(
            "DELETE FROM causal_chains WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY trigger_error, resolution_file, trigger_command
                        ORDER BY confidence DESC, created_at DESC
                    ) AS rn
                    FROM causal_chains
                    WHERE trigger_error IS NOT NULL
                )
                WHERE rn = 1
            ) AND trigger_error IS NOT NULL",
            [],
        )?;
        Ok(deleted as u32)
    })
    .await
}

/// Prune causal chains with confidence < 0.1 that are older than 30 days.
pub async fn prune_stale(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        let deleted = conn.execute(
            "DELETE FROM causal_chains WHERE confidence < 0.1 AND created_at < datetime('now', '-30 days')",
            [],
        )?;
        Ok(deleted as u32)
    })
    .await
}

/// Summarize commands with > 50 executions: keep last 10, create summary, delete rest.
pub async fn summarize_executions(db: &Db) -> Result<u32> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT command, COUNT(*) as cnt FROM executions GROUP BY command HAVING cnt > 50",
        )?;
        let commands: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        let mut total_summarized: u32 = 0;

        for (command, count) in &commands {
            let (success_rate, avg_duration_f, last_error, first_seen, last_seen): (
                f64,
                f64,
                Option<String>,
                String,
                String,
            ) = conn.query_row(
                "SELECT
                    CAST(SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*),
                    AVG(duration_ms),
                    (SELECT summary FROM executions WHERE command = ?1 AND exit_code != 0 ORDER BY created_at DESC LIMIT 1),
                    MIN(created_at),
                    MAX(created_at)
                FROM executions WHERE command = ?1",
                [command],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )?;
            let avg_duration = avg_duration_f as i64;

            conn.execute(
                "INSERT INTO execution_summaries (command, total_runs, success_rate, avg_duration_ms, last_error, first_seen, last_seen)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(command) DO UPDATE SET
                    total_runs = total_runs + ?2,
                    success_rate = ?3,
                    avg_duration_ms = ?4,
                    last_error = ?5,
                    last_seen = ?7",
                rusqlite::params![command, count, success_rate, avg_duration, last_error, first_seen, last_seen],
            )?;

            let deleted = conn.execute(
                "DELETE FROM executions WHERE command = ?1 AND id NOT IN (
                    SELECT id FROM executions WHERE command = ?1 ORDER BY created_at DESC LIMIT 10
                )",
                [command],
            )?;

            total_summarized += deleted as u32;
        }

        Ok(total_summarized)
    })
    .await
}

/// Run all compaction strategies.
pub async fn run_compaction(db: &Db) -> Result<CompactionStats> {
    let chains_merged = merge_duplicates(db).await?;
    let chains_pruned = prune_stale(db).await?;
    let executions_summarized = summarize_executions(db).await?;
    Ok(CompactionStats {
        chains_merged,
        chains_pruned,
        executions_summarized,
    })
}
