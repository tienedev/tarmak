use cortx_types::{CodeLocation, ExecutionRecord, Memory, MemoryOrgan, MemorySource, RecallQuery, Tier};

#[tokio::test]
async fn test_recall_fts5_search() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    db.store(Memory::ProjectFact {
        fact: "The authentication module validates JWT tokens".to_string(),
        citation: "src/auth.rs:10".to_string(),
        source: MemorySource::Agent,
    })
    .await
    .unwrap();
    db.store(Memory::ProjectFact {
        fact: "Database uses WAL mode for concurrency".to_string(),
        citation: "src/db/mod.rs:5".to_string(),
        source: MemorySource::Agent,
    })
    .await
    .unwrap();

    let hints = db
        .recall(RecallQuery {
            text: Some("JWT".to_string()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(hints.len(), 1);
    assert!(hints[0].summary.contains("JWT"));
}

#[tokio::test]
async fn test_recall_by_file() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    db.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".to_string(),
        trigger_error: Some("assertion failed".to_string()),
        trigger_command: None,
        resolution_files: vec!["src/db/repo.rs".to_string()],
    })
    .await
    .unwrap();

    let hints = db
        .recall(RecallQuery {
            files: vec!["src/auth.rs".to_string()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(hints.len(), 1);
    assert_eq!(hints[0].kind, "causal_chain");
}

#[tokio::test]
async fn test_last_failure_for_command() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    db.store(Memory::Execution(ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: None,
        command: "cargo test".to_string(),
        exit_code: Some(101),
        tier: Tier::Safe,
        duration_ms: 1000,
        summary: "test failed".to_string(),
        errors: vec![CodeLocation {
            file: "src/auth.rs".to_string(),
            line: Some(42),
            msg: "assertion failed".to_string(),
        }],
        files_touched: vec![],
    }))
    .await
    .unwrap();
    db.store(Memory::Execution(ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: None,
        command: "cargo clippy".to_string(),
        exit_code: Some(0),
        tier: Tier::Safe,
        duration_ms: 500,
        summary: "ok".to_string(),
        errors: vec![],
        files_touched: vec![],
    }))
    .await
    .unwrap();

    let fail = db.last_failure_for_command("cargo test").await.unwrap();
    assert!(fail.is_some());
    assert_eq!(fail.unwrap().command, "cargo test");

    let no_fail = db.last_failure_for_command("cargo clippy").await.unwrap();
    assert!(no_fail.is_none());
}

#[tokio::test]
async fn test_recall_error_patterns() {
    let ctx = context_db::ContextDb::in_memory().await.unwrap();
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("assertion failed: token.is_valid()".into()),
        trigger_command: None,
        resolution_files: vec!["src/db/repo.rs".into()],
    })
    .await
    .unwrap();

    let hints = ctx
        .recall(RecallQuery {
            error_patterns: vec!["assertion failed".into()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(!hints.is_empty(), "Should find causal chain matching error pattern");
    assert!(hints[0].summary.contains("auth.rs"));
}
