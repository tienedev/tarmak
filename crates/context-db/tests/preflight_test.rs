use context_db::ContextDb;
use cortx_types::{Memory, MemoryOrgan};

#[tokio::test]
async fn preflight_returns_hints_for_known_failure_pattern() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a causal chain: cargo test failed on auth.rs, fixed by editing middleware.rs
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/middleware.rs".into()],
    })
    .await
    .unwrap();

    // Pre-flight for "cargo test" should find this hint
    let hints = ctx
        .recall_for_preflight("cargo test", &["src/auth.rs"])
        .await
        .unwrap();
    assert!(!hints.is_empty(), "should return at least one hint");
    assert!(hints[0].confidence >= 0.5);
}

#[tokio::test]
async fn preflight_returns_empty_for_unknown_command() {
    let ctx = ContextDb::in_memory().await.unwrap();
    let hints = ctx.recall_for_preflight("echo hello", &[]).await.unwrap();
    assert!(hints.is_empty());
}

#[tokio::test]
async fn preflight_filters_below_min_confidence() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store a causal chain
    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("test failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    // Manually lower confidence to below threshold
    ctx.db()
        .with_conn(|conn| {
            conn.execute("UPDATE causal_chains SET confidence = 0.1", [])?;
            Ok(())
        })
        .await
        .unwrap();

    let hints = ctx
        .recall_for_preflight("cargo test", &["src/auth.rs"])
        .await
        .unwrap();
    // All returned hints should have confidence >= 0.5
    assert!(
        hints.iter().all(|h| h.confidence >= 0.5),
        "should filter low-confidence hints"
    );
}
