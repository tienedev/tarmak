use crate::db::Db;
use anyhow::Result;

pub struct SessionReport {
    pub session_id: String,
    pub board_id: Option<String>,
    pub tasks_completed: u32,
    pub tasks_escalated: u32,
    pub commands_run: u32,
    pub chains_created: u32,
    pub duration_seconds: Option<u32>,
    pub summary: String,
}

pub async fn store_session_report(db: &Db, report: &SessionReport) -> Result<()> {
    let sid = report.session_id.clone();
    let bid = report.board_id.clone();
    let tasks_completed = report.tasks_completed;
    let tasks_escalated = report.tasks_escalated;
    let commands_run = report.commands_run;
    let chains_created = report.chains_created;
    let duration_seconds = report.duration_seconds;
    let sum = report.summary.clone();
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
