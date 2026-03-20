use anyhow::Result;
use cortx_types::{ExecutionRecord, Memory, MemoryId, MemorySource};

use crate::db::Db;

pub async fn store_memory(db: &Db, memory: Memory) -> Result<MemoryId> {
    match memory {
        Memory::Execution(record) => store_execution(db, record).await,
        Memory::CausalChain {
            trigger_file,
            trigger_error,
            trigger_command,
            resolution_files,
        } => {
            store_causal_chain(
                db,
                trigger_file,
                trigger_error,
                trigger_command,
                resolution_files,
            )
            .await
        }
        Memory::ProjectFact {
            fact,
            citation,
            source,
        } => store_project_fact(db, fact, citation, source).await,
    }
}

async fn store_execution(db: &Db, record: ExecutionRecord) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let errors_json = serde_json::to_string(
        &record
            .errors
            .iter()
            .map(|e| serde_json::json!({ "file": e.file, "line": e.line, "msg": e.msg }))
            .collect::<Vec<_>>(),
    )?;
    let files_json = serde_json::to_string(&record.files_touched)?;

    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO executions (id, session_id, task_id, command, exit_code, tier, duration_ms, summary, errors, files_touched, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                id_clone,
                record.session_id,
                record.task_id,
                record.command,
                record.exit_code,
                record.tier.as_str(),
                record.duration_ms as i64,
                record.summary,
                errors_json,
                files_json,
                now
            ],
        )?;
        Ok(())
    })
    .await?;
    Ok(MemoryId(id))
}

async fn store_causal_chain(
    db: &Db,
    trigger_file: String,
    trigger_error: Option<String>,
    trigger_command: Option<String>,
    resolution_files: Vec<String>,
) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    db.with_conn(move |conn| {
        for res_file in &resolution_files {
            let id_inner = uuid::Uuid::new_v4().to_string();
            let cmd = trigger_command.as_deref().unwrap_or("");
            conn.execute(
                "INSERT INTO causal_chains (id, trigger_file, trigger_error, trigger_command, resolution_file, last_verified, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(trigger_file, trigger_command, resolution_file) DO UPDATE SET
                   attempts = attempts + 1, successes = successes + 1,
                   confidence = MIN(1.0, confidence + 0.1), last_verified = ?6",
                rusqlite::params![id_inner, trigger_file, trigger_error, cmd, res_file, now],
            )?;
        }
        Ok(())
    })
    .await?;
    Ok(MemoryId(id))
}

async fn store_project_fact(
    db: &Db,
    fact: String,
    citation: String,
    source: MemorySource,
) -> Result<MemoryId> {
    let id = uuid::Uuid::new_v4().to_string();
    let id_clone = id.clone();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let source_str = match source {
        MemorySource::Agent => "agent",
        MemorySource::Proxy => "proxy",
        MemorySource::User => "user",
    };

    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO project_facts (id, fact, citation, source, confidence, verified_at, created_at)
             VALUES (?1, ?2, ?3, ?4, 1.0, ?5, ?5)",
            rusqlite::params![id_clone, fact, citation, source_str, now],
        )?;
        Ok(())
    })
    .await?;
    Ok(MemoryId(id))
}
