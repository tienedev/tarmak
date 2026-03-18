use std::time::Duration;
use chrono::Utc;
use crate::db::Db;
use crate::notifications::{self, NotifTx};

/// Runs every hour. Creates deadline notifications for tasks due within 24h.
pub async fn deadline_checker(db: Db, tx: NotifTx) {
    let mut interval = tokio::time::interval(Duration::from_secs(3600));
    loop {
        interval.tick().await;
        if let Err(e) = check_deadlines(&db, &tx).await {
            tracing::error!("deadline checker error: {e}");
        }
    }
}

async fn check_deadlines(db: &Db, tx: &NotifTx) -> anyhow::Result<()> {
    let now = Utc::now();
    let tomorrow = now + chrono::Duration::hours(24);
    let now_str = now.format("%Y-%m-%d").to_string();
    let tomorrow_str = tomorrow.format("%Y-%m-%d").to_string();

    // Find tasks with due_date between now and now+24h that have an assignee
    let tasks = db.get_tasks_due_between(&now_str, &tomorrow_str).await?;

    for (task_id, board_id, title, assignee_name) in tasks {
        // Resolve assignee name to user_id
        let user = match db.get_user_by_name(&assignee_name).await? {
            Some(u) => u,
            None => continue,
        };

        // Skip if deadline notification already sent
        if db.has_deadline_notification(&task_id, &user.id).await? {
            continue;
        }

        let notif_title = format!("Task \"{}\" is due tomorrow", title);
        if let Ok(notif) = db
            .create_notification(&user.id, &board_id, Some(&task_id), "deadline", &notif_title, None)
            .await
        {
            notifications::broadcast(tx, &notif);
        }
    }
    Ok(())
}
