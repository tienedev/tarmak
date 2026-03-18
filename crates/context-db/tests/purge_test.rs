use cortx_types::{Memory, MemoryOrgan};

#[tokio::test]
async fn test_purge_unconfirmed_chains() {
    let db = context_db::ContextDb::in_memory().await.unwrap();
    db.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".to_string(),
        trigger_error: Some("error".to_string()),
        resolution_files: vec!["src/fix.rs".to_string()],
    })
    .await
    .unwrap();

    // Purge with a 0-day threshold (purge everything unconfirmed)
    let purged = context_db::purge::purge_unconfirmed_chains(db.db(), 0).await.unwrap();
    assert_eq!(purged, 1);
}

#[tokio::test]
async fn test_db_size_check() {
    let ctx = context_db::ContextDb::in_memory().await.unwrap();
    let size = context_db::purge::db_size_bytes(ctx.db()).await.unwrap();
    assert!(size < 100 * 1024 * 1024);
}
