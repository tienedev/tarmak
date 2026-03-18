use cortx_types::{CodeLocation, ExecutionRecord, Memory, MemoryOrgan, Tier};

#[tokio::test]
async fn test_store_execution() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let record = ExecutionRecord {
        session_id: "sess-1".to_string(),
        task_id: Some("task-1".to_string()),
        command: "cargo test".to_string(),
        exit_code: Some(101),
        tier: Tier::Safe,
        duration_ms: 2340,
        summary: "3 tests failed".to_string(),
        errors: vec![CodeLocation {
            file: "src/auth.rs".to_string(),
            line: Some(42),
            msg: "assertion failed".to_string(),
        }],
        files_touched: vec!["src/auth.rs".to_string()],
    };
    let id = db.store(Memory::Execution(record)).await.unwrap();
    assert!(!id.0.is_empty());
    let count = db.execution_count().await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_store_project_fact() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let id = db
        .store(Memory::ProjectFact {
            fact: "The auth module uses JWT tokens".to_string(),
            citation: "src/auth.rs:10".to_string(),
            source: cortx_types::MemorySource::Agent,
        })
        .await
        .unwrap();
    assert!(!id.0.is_empty());
}

#[tokio::test]
async fn test_store_causal_chain() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    let id = db
        .store(Memory::CausalChain {
            trigger_file: "src/auth.rs".to_string(),
            trigger_error: Some("assertion failed".to_string()),
            resolution_files: vec!["src/db/repo.rs".to_string()],
        })
        .await
        .unwrap();
    assert!(!id.0.is_empty());
}
