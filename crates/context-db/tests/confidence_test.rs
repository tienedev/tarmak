use context_db::ContextDb;
use cortx_types::{Memory, MemoryOrgan};

#[tokio::test]
async fn reinforce_confidence_increases_on_positive_delta() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let chain_id = get_first_chain_id(&ctx).await;

    ctx.reinforce_confidence(&chain_id, 0.15).await.unwrap();

    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!(
        (confidence - 0.65).abs() < 0.01,
        "expected ~0.65, got {confidence}"
    );
}

#[tokio::test]
async fn reinforce_confidence_caps_at_one() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let chain_id = get_first_chain_id(&ctx).await;

    ctx.reinforce_confidence(&chain_id, 0.8).await.unwrap();

    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!(
        (confidence - 1.0).abs() < 0.01,
        "expected 1.0, got {confidence}"
    );
}

#[tokio::test]
async fn reinforce_confidence_decreases_on_negative_delta() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("failed".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/fix.rs".into()],
    })
    .await
    .unwrap();

    let chain_id = get_first_chain_id(&ctx).await;

    ctx.reinforce_confidence(&chain_id, -0.20).await.unwrap();

    let confidence = get_chain_confidence(&ctx, &chain_id).await;
    assert!(
        (confidence - 0.30).abs() < 0.01,
        "expected ~0.30, got {confidence}"
    );
}

async fn get_first_chain_id(ctx: &ContextDb) -> String {
    ctx.db()
        .with_conn(|conn| {
            let id: String =
                conn.query_row("SELECT id FROM causal_chains LIMIT 1", [], |row| row.get(0))?;
            Ok(id)
        })
        .await
        .unwrap()
}

async fn get_chain_confidence(ctx: &ContextDb, chain_id: &str) -> f64 {
    let id = chain_id.to_string();
    ctx.db()
        .with_conn(move |conn| {
            let conf: f64 = conn.query_row(
                "SELECT confidence FROM causal_chains WHERE id = ?1",
                [&id],
                |row| row.get(0),
            )?;
            Ok(conf)
        })
        .await
        .unwrap()
}
