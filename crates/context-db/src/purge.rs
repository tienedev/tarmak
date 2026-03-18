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
        let count1 = conn.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'causal_chains', json_object('trigger_file', trigger_file, 'trigger_error', trigger_error, 'resolution_file', resolution_file, 'confidence', confidence), datetime('now')
             FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        conn.execute(
            "DELETE FROM causal_chains WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        let count2 = conn.execute(
            "INSERT INTO archived_memories (id, source_table, data, archived_at)
             SELECT id, 'project_facts', json_object('fact', fact, 'citation', citation, 'source', source, 'confidence', confidence), datetime('now')
             FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
        conn.execute(
            "DELETE FROM project_facts WHERE confidence < ?1",
            rusqlite::params![threshold],
        )?;
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
