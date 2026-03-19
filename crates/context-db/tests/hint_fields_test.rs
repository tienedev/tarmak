use context_db::ContextDb;
use cortx_types::{Memory, MemoryOrgan, MemorySource, RecallQuery};

#[tokio::test]
async fn recall_returns_hints_with_source_and_chain_id() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let hints = ctx
        .recall(RecallQuery {
            files: vec!["src/auth.rs".into()],
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(!hints.is_empty());
    assert!(matches!(hints[0].source, MemorySource::Proxy));
    assert!(
        hints[0].chain_id.is_some(),
        "chain_id should be populated for causal chain hints"
    );
}
