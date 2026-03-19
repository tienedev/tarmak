use anyhow::Result;
use crate::db::Db;

pub async fn purge_unconfirmed_chains(db: &Db, age_days: u32) -> Result<u64> {
    let age_days = age_days as i64;
    db.with_conn(move |conn| {
        let deleted = conn.execute(
            "DELETE FROM causal_chains WHERE attempts < 2 AND julianday('now') - julianday(created_at) >= ?1",
            rusqlite::params![age_days],
        )?;
        Ok(deleted as u64)
    })
    .await
}

pub async fn archive_low_confidence(db: &Db, threshold: f64) -> Result<u64> {
    db.with_conn(move |conn| {
        let tx = conn.transaction()?;
        let count1 = tx.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'causal_chains', json_object('trigger_file', trigger_file, 'trigger_error', trigger_error, 'resolution_file', resolution_file, 'confidence', confidence), datetime('now')
             FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        tx.execute(
            "DELETE FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        let count2 = tx.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'project_facts', json_object('fact', fact, 'citation', citation, 'source', source, 'confidence', confidence), datetime('now')
             FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        tx.execute(
            "DELETE FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        tx.commit()?;
        Ok((count1 + count2) as u64)
    })
    .await
}

pub async fn purge_old_executions(db: &Db, age_days: u32) -> Result<u64> {
    let age_days = age_days as i64;
    db.with_conn(move |conn| {
        let deleted = conn.execute(
            "DELETE FROM executions WHERE julianday('now') - julianday(created_at) > ?1",
            rusqlite::params![age_days],
        )?;
        Ok(deleted as u64)
    })
    .await
}

/// Get the current database size in bytes (page_count * page_size).
pub async fn db_size_bytes(db: &Db) -> Result<u64> {
    db.with_conn(|conn| {
        let page_count: u64 = conn.pragma_query_value(None, "page_count", |r| r.get(0))?;
        let page_size: u64 = conn.pragma_query_value(None, "page_size", |r| r.get(0))?;
        Ok(page_count * page_size)
    })
    .await
}

/// Purge oldest executions until DB is under the size limit (in bytes).
pub async fn purge_if_over_size(db: &Db, max_bytes: u64) -> Result<u64> {
    let mut total_deleted = 0u64;
    loop {
        let size = db_size_bytes(db).await?;
        if size <= max_bytes {
            break;
        }
        let deleted = db
            .with_conn(|conn| {
                let d = conn.execute(
                    "DELETE FROM executions WHERE id IN (SELECT id FROM executions ORDER BY created_at ASC LIMIT 100)",
                    [],
                )?;
                Ok(d as u64)
            })
            .await?;
        if deleted == 0 {
            break;
        }
        total_deleted += deleted;
    }
    Ok(total_deleted)
}
