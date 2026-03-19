use crate::db::Db;
use anyhow::Result;

pub async fn store_session_report(
    db: &Db,
    session_id: &str,
    board_id: Option<&str>,
    tasks_completed: u32,
    tasks_escalated: u32,
    commands_run: u32,
    chains_created: u32,
    duration_seconds: Option<u32>,
    summary: &str,
) -> Result<()> {
    let sid = session_id.to_string();
    let bid = board_id.map(String::from);
    let sum = summary.to_string();
    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO session_reports (session_id, board_id, tasks_completed, tasks_escalated, commands_run, chains_created, duration_seconds, summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![sid, bid, tasks_completed, tasks_escalated, commands_run, chains_created, duration_seconds, sum],
        )?;
        Ok(())
    })
    .await
}
