use cortx_types::AgentCommentEvent;
use std::path::PathBuf;

#[tokio::test]
async fn comment_on_task_creates_formatted_comment() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory)
        .await
        .unwrap();

    let board_id = create_test_board(orch.kanwise().db()).await;
    let column_id = create_test_column(orch.kanwise().db(), &board_id).await;
    let task_id = create_test_task(orch.kanwise().db(), &board_id, &column_id, "Test task").await;

    orch.comment_on_task(
        &task_id,
        AgentCommentEvent::Bug,
        "Found null pointer in auth module",
    )
    .await
    .unwrap();

    let comments = get_task_comments(orch.kanwise().db(), &task_id).await;
    assert_eq!(comments.len(), 1);
    assert!(comments[0].contains("Bug encountered"));
    assert!(comments[0].contains("null pointer"));
}

#[tokio::test]
async fn ensure_agent_user_is_idempotent() {
    let db = kanwise::db::Db::in_memory().await.unwrap();
    let id1 = db.ensure_agent_user().await.unwrap();
    let id2 = db.ensure_agent_user().await.unwrap();
    assert_eq!(id1, id2, "should return same user ID on repeated calls");
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

async fn create_test_board(db: &kanwise::db::Db) -> String {
    let now = now_rfc3339();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?1, 'Test', ?2, ?3)",
            rusqlite::params![id, now, now],
        )?;
        Ok(id)
    })
    .await
    .unwrap()
}

async fn create_test_column(db: &kanwise::db::Db, board_id: &str) -> String {
    let bid = board_id.to_string();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO columns (id, board_id, name, position) VALUES (?1, ?2, 'Todo', 0)",
            rusqlite::params![id, bid],
        )?;
        Ok(id)
    })
    .await
    .unwrap()
}

async fn create_test_task(
    db: &kanwise::db::Db,
    board_id: &str,
    column_id: &str,
    title: &str,
) -> String {
    let bid = board_id.to_string();
    let cid = column_id.to_string();
    let t = title.to_string();
    let now = now_rfc3339();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO tasks (id, board_id, column_id, title, priority, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'medium', 0, ?5, ?6)",
            rusqlite::params![id, bid, cid, t, now, now],
        )?;
        Ok(id)
    }).await.unwrap()
}

async fn get_task_comments(db: &kanwise::db::Db, task_id: &str) -> Vec<String> {
    let tid = task_id.to_string();
    db.with_conn(move |conn| {
        let mut stmt = conn.prepare("SELECT content FROM comments WHERE task_id = ?1")?;
        let rows = stmt
            .query_map([&tid], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
    .await
    .unwrap()
}
