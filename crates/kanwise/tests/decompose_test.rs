use kanwise::db::models::Priority;
use kanwise::{DecomposeTask, Kanwise};

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tokio::test]
async fn decompose_creates_tasks_with_labels() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let _column_id = create_test_column(&db, &board_id).await;

    let kw = Kanwise::new(db);

    let tasks = vec![
        DecomposeTask {
            title: "Setup OAuth config".into(),
            description: "Configure OAuth provider settings".into(),
            priority: Priority::High,
            depends_on: vec![],
        },
        DecomposeTask {
            title: "Implement callback".into(),
            description: "Handle OAuth callback endpoint".into(),
            priority: Priority::Medium,
            depends_on: vec![0],
        },
    ];

    let created = kw
        .decompose("Add OAuth authentication", &board_id, tasks)
        .await
        .unwrap();

    assert_eq!(created.len(), 2);
}

#[tokio::test]
async fn decompose_rejects_cyclic_dependencies() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let _column_id = create_test_column(&db, &board_id).await;

    let kw = Kanwise::new(db);

    let tasks = vec![
        DecomposeTask {
            title: "Task A".into(),
            description: "".into(),
            priority: Priority::Medium,
            depends_on: vec![1],
        },
        DecomposeTask {
            title: "Task B".into(),
            description: "".into(),
            priority: Priority::Medium,
            depends_on: vec![0],
        },
    ];

    let result = kw.decompose("test", &board_id, tasks).await;
    assert!(result.is_err(), "cyclic dependencies should be rejected");
}

#[tokio::test]
async fn decompose_auto_creates_ai_ready_label() {
    let db = kanwise::db::Db::in_memory().await.unwrap();

    let board_id = create_test_board(&db).await;
    let _column_id = create_test_column(&db, &board_id).await;

    let kw = Kanwise::new(db);

    let tasks = vec![DecomposeTask {
        title: "First task".into(),
        description: "desc".into(),
        priority: Priority::Medium,
        depends_on: vec![],
    }];

    let created = kw.decompose("test", &board_id, tasks).await.unwrap();
    assert_eq!(created.len(), 1);

    // Verify ai-ready label was auto-created — claim should find the task
    let task = kw.claim_task(&board_id, "agent-1").await.unwrap();
    assert!(
        task.is_some(),
        "decomposed task should be claimable via ai-ready label"
    );
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
