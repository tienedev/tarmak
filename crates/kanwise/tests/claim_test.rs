use kanwise::Kanwise;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tokio::test]
async fn claim_task_locks_atomically() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let column_id = create_test_column(&db, &board_id).await;
    let label_id = create_test_label(&db, &board_id, "ai-ready").await;
    let task_id = create_test_task(&db, &board_id, &column_id, "Test task").await;
    attach_label(&db, &task_id, &label_id).await;

    let kw = Kanwise::new(db);

    // Agent 1 claims
    let task = kw.claim_task(&board_id, "agent-1").await.unwrap();
    assert!(task.is_some(), "agent-1 should get the task");

    // Agent 2 tries to claim — should get None (no available tasks)
    let task2 = kw.claim_task(&board_id, "agent-2").await.unwrap();
    assert!(task2.is_none(), "agent-2 should not get a locked task");
}

#[tokio::test]
async fn release_task_unlocks() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let column_id = create_test_column(&db, &board_id).await;
    let label_id = create_test_label(&db, &board_id, "ai-ready").await;
    let task_id = create_test_task(&db, &board_id, &column_id, "Test task").await;
    attach_label(&db, &task_id, &label_id).await;

    let kw = Kanwise::new(db);

    // Claim then release
    let task = kw.claim_task(&board_id, "agent-1").await.unwrap().unwrap();
    kw.release_task(&task.id, "testing release").await.unwrap();

    // Now another agent can claim it
    let task2 = kw.claim_task(&board_id, "agent-2").await.unwrap();
    assert!(task2.is_some(), "task should be claimable after release");
}

// Helpers
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

async fn create_test_label(db: &kanwise::db::Db, board_id: &str, name: &str) -> String {
    let bid = board_id.to_string();
    let n = name.to_string();
    db.with_conn(move |conn| {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO labels (id, board_id, name, color) VALUES (?1, ?2, ?3, '#00ff00')",
            rusqlite::params![id, bid, n],
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
    })
    .await
    .unwrap()
}

async fn attach_label(db: &kanwise::db::Db, task_id: &str, label_id: &str) {
    let tid = task_id.to_string();
    let lid = label_id.to_string();
    db.with_conn(move |conn| {
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            rusqlite::params![tid, lid],
        )?;
        Ok(())
    })
    .await
    .unwrap();
}
