use anyhow::Result;
use cortx_types::{CodeLocation, ExecutionRecord, MemoryHint, MemorySource, RecallQuery, Tier};
use rusqlite::OptionalExtension;

use crate::db::Db;

pub async fn recall(db: &Db, query: RecallQuery, project_root: Option<&str>) -> Result<Vec<MemoryHint>> {
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
                source: MemorySource::Agent,
                chain_id: None,
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
                    "SELECT id, trigger_file, trigger_error, resolution_file, confidence
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
                let results: Vec<(String, String, Option<String>, String, f64)> = stmt
                    .query_map(&*params_refs, |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok(results)
            })
            .await?;
        for (id, trigger, error, resolution, raw_confidence) in chain_results {
            let confidence = match project_root {
                Some(cwd) => {
                    let commits =
                        crate::decay::count_commits_since(&trigger, "1970-01-01", cwd);
                    crate::decay::compute_confidence(
                        raw_confidence,
                        commits,
                        crate::decay::DEFAULT_CHURN_NORMALIZER,
                    )
                }
                None => raw_confidence,
            };
            if confidence < query.min_confidence.unwrap_or(0.0) {
                continue;
            }
            let error_str = error.as_deref().unwrap_or("unknown error");
            hints.push(MemoryHint {
                kind: "causal_chain".to_string(),
                summary: format!("When {trigger} fails with \"{error_str}\", check {resolution}"),
                confidence,
                source: MemorySource::Proxy,
                chain_id: Some(id.clone()),
            });
        }
    }

    // Error-pattern search on causal_chains
    if !query.error_patterns.is_empty() {
        let patterns = query.error_patterns.clone();
        let min_conf = query.min_confidence.unwrap_or(0.0);
        let project_root_owned = project_root.map(|s| s.to_string());
        let error_results = db
            .with_conn(move |conn| {
                let mut all_results = Vec::new();
                for pattern in &patterns {
                    let like_pattern = format!("%{pattern}%");
                    let mut stmt = conn.prepare(
                        "SELECT id, trigger_file, trigger_error, resolution_file, confidence
                         FROM causal_chains WHERE trigger_error LIKE ?1 AND confidence >= ?2
                         ORDER BY confidence DESC LIMIT 10",
                    )?;
                    let rows: Vec<(String, String, Option<String>, String, f64)> = stmt
                        .query_map(rusqlite::params![like_pattern, min_conf], |row| {
                            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                        })?
                        .filter_map(|r| r.ok())
                        .collect();
                    all_results.extend(rows);
                }
                Ok(all_results)
            })
            .await?;
        for (id, trigger, error, resolution, raw_confidence) in error_results {
            let confidence = match project_root_owned.as_deref() {
                Some(cwd) => {
                    let commits =
                        crate::decay::count_commits_since(&trigger, "1970-01-01", cwd);
                    crate::decay::compute_confidence(
                        raw_confidence,
                        commits,
                        crate::decay::DEFAULT_CHURN_NORMALIZER,
                    )
                }
                None => raw_confidence,
            };
            let error_str = error.as_deref().unwrap_or("unknown error");
            hints.push(MemoryHint {
                kind: "causal_chain".to_string(),
                summary: format!(
                    "When {trigger} fails with \"{error_str}\", check {resolution}"
                ),
                confidence,
                source: MemorySource::Proxy,
                chain_id: Some(id.clone()),
            });
        }
    }

    Ok(hints)
}

/// Pre-flight memory check: search for hints relevant to a command
/// about to be executed. Returns hints with confidence >= 0.5.
pub async fn recall_for_preflight(
    db: &Db,
    command: &str,
    files: &[&str],
    project_root: Option<&str>,
) -> Result<Vec<MemoryHint>> {
    let query = RecallQuery {
        text: Some(command.to_string()),
        files: files.iter().map(|f| f.to_string()).collect(),
        error_patterns: vec![],
        min_confidence: Some(0.5),
    };
    recall(db, query, project_root).await
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
