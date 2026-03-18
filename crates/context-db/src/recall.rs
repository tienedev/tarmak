use anyhow::Result;
use cortx_types::{CodeLocation, ExecutionRecord, MemoryHint, RecallQuery, Tier};
use rusqlite::OptionalExtension;

use crate::db::Db;

pub async fn recall(db: &Db, query: RecallQuery) -> Result<Vec<MemoryHint>> {
    let mut hints = Vec::new();

    // FTS5 text search on project_facts
    if let Some(text) = &query.text {
        let text = text.clone();
        let min_conf = query.min_confidence.unwrap_or(0.0);
        let fts_results = db
            .with_conn(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT pf.fact, pf.citation, pf.confidence
                     FROM project_facts pf
                     JOIN memory_fts ON memory_fts.rowid = pf.rowid
                     WHERE memory_fts MATCH ?1 AND pf.confidence >= ?2
                     ORDER BY pf.confidence DESC LIMIT 10",
                )?;
                let results: Vec<(String, String, f64)> = stmt
                    .query_map(rusqlite::params![text, min_conf], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok(results)
            })
            .await?;
        for (fact, citation, confidence) in fts_results {
            hints.push(MemoryHint {
                kind: "project_fact".to_string(),
                summary: format!("{fact} [{citation}]"),
                confidence,
            });
        }
    }

    // File-based search on causal_chains
    if !query.files.is_empty() {
        let files = query.files.clone();
        let min_conf = query.min_confidence.unwrap_or(0.0);
        let chain_results = db
            .with_conn(move |conn| {
                let placeholders: Vec<String> =
                    (1..=files.len()).map(|i| format!("?{i}")).collect();
                let sql = format!(
                    "SELECT trigger_file, trigger_error, resolution_file, confidence
                     FROM causal_chains WHERE trigger_file IN ({}) AND confidence >= ?{}
                     ORDER BY confidence DESC LIMIT 10",
                    placeholders.join(","),
                    files.len() + 1
                );
                let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = files
                    .into_iter()
                    .map(|f| Box::new(f) as Box<dyn rusqlite::types::ToSql>)
                    .collect();
                params.push(Box::new(min_conf));
                let params_refs: Vec<&dyn rusqlite::types::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                let mut stmt = conn.prepare(&sql)?;
                let results: Vec<(String, Option<String>, String, f64)> = stmt
                    .query_map(&*params_refs, |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok(results)
            })
            .await?;
        for (trigger, error, resolution, confidence) in chain_results {
            let error_str = error.as_deref().unwrap_or("unknown error");
            hints.push(MemoryHint {
                kind: "causal_chain".to_string(),
                summary: format!("When {trigger} fails with \"{error_str}\", check {resolution}"),
                confidence,
            });
        }
    }
    Ok(hints)
}

pub async fn last_failure_for_command(
    db: &Db,
    command: &str,
) -> Result<Option<ExecutionRecord>> {
    let command = command.to_string();
    db.with_conn(move |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, task_id, command, exit_code, tier, duration_ms, summary, errors, files_touched
             FROM executions WHERE command = ?1 AND exit_code IS NOT NULL AND exit_code != 0
             ORDER BY created_at DESC LIMIT 1",
        )?;
        let record = stmt
            .query_row(rusqlite::params![command], |row| {
                let errors_json: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
                let files_json: String = row.get::<_, Option<String>>(9)?.unwrap_or_default();
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i32>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?.unwrap_or(0) as u64,
                    row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    errors_json,
                    files_json,
                ))
            })
            .optional()?;
        match record {
            Some((
                session_id,
                task_id,
                command,
                exit_code,
                tier_str,
                duration_ms,
                summary,
                errors_json,
                files_json,
            )) => {
                let errors: Vec<CodeLocation> =
                    serde_json::from_str::<Vec<serde_json::Value>>(&errors_json)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|v| CodeLocation {
                            file: v["file"].as_str().unwrap_or("").to_string(),
                            line: v["line"].as_u64().map(|n| n as u32),
                            msg: v["msg"].as_str().unwrap_or("").to_string(),
                        })
                        .collect();
                let files_touched: Vec<String> =
                    serde_json::from_str(&files_json).unwrap_or_default();
                Ok(Some(ExecutionRecord {
                    session_id,
                    task_id,
                    command,
                    exit_code,
                    tier: Tier::from_str_db(&tier_str).unwrap_or(Tier::Safe),
                    duration_ms,
                    summary,
                    errors,
                    files_touched,
                }))
            }
            None => Ok(None),
        }
    })
    .await
}
