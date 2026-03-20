use kanwise::TaskFilter;

#[tokio::test]
async fn test_get_next_task_returns_ai_ready_tasks() {
    let db = kanwise::Db::in_memory().await.unwrap();

    let board = db.create_board("Test Board", None).await.unwrap();
    let col = db
        .create_column(&board.id, "Todo", None, None)
        .await
        .unwrap();
    let label = db
        .create_label(&board.id, "ai-ready", "#00ff00")
        .await
        .unwrap();
    let task = db
        .create_task(
            &board.id,
            &col.id,
            "Fix auth bug",
            None,
            kanwise::db::models::Priority::High,
            None,
        )
        .await
        .unwrap();
    db.add_task_label(&task.id, &label.id).await.unwrap();

    let organ = kanwise::Kanwise::new(db);
    let filter = TaskFilter {
        board_id: Some(board.id.clone()),
        label: Some("ai-ready".to_string()),
        ..Default::default()
    };
    let next = organ.get_next_task(filter).await.unwrap();
    assert_eq!(next.title, "Fix auth bug");
    assert!(next.labels.contains(&"ai-ready".to_string()));
}

#[tokio::test]
async fn test_list_tasks_maps_labels() {
    let db = kanwise::Db::in_memory().await.unwrap();
    let board = db.create_board("Board", None).await.unwrap();
    let col = db
        .create_column(&board.id, "Todo", None, None)
        .await
        .unwrap();
    let label = db
        .create_label(&board.id, "urgent", "#ff0000")
        .await
        .unwrap();
    let task = db
        .create_task(
            &board.id,
            &col.id,
            "Task 1",
            None,
            kanwise::db::models::Priority::Medium,
            None,
        )
        .await
        .unwrap();
    db.add_task_label(&task.id, &label.id).await.unwrap();

    let organ = kanwise::Kanwise::new(db);
    let tasks = organ.list_tasks_summary(&board.id).await.unwrap();
    assert_eq!(tasks.len(), 1);
    assert!(tasks[0].labels.contains(&"urgent".to_string()));
}
