use context_db::ContextDb;
use cortx_types::{Memory, MemoryOrgan};

#[tokio::test]
async fn prune_removes_low_confidence_old_chains() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "old.rs".into(),
        trigger_error: Some("old error".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["old_fix.rs".into()],
    })
    .await
    .unwrap();

    // Set confidence to 0.05 and created_at to 60 days ago
    ctx.db()
        .with_conn(|conn| {
            conn.execute(
                "UPDATE causal_chains SET confidence = 0.05, created_at = datetime('now', '-60 days')",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

    let pruned = ctx.run_compaction().await.unwrap();
    assert!(pruned.chains_pruned > 0, "should prune stale chain");
}

#[tokio::test]
async fn merge_deduplicates_chains_with_same_error_different_trigger_file() {
    let ctx = ContextDb::in_memory().await.unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/auth.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/config.rs".into()],
    })
    .await
    .unwrap();

    ctx.store(Memory::CausalChain {
        trigger_file: "src/api.rs".into(),
        trigger_error: Some("connection refused".into()),
        trigger_command: Some("cargo test".into()),
        resolution_files: vec!["src/config.rs".into()],
    })
    .await
    .unwrap();

    let count_before: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 =
                conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |row| row.get(0))?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(count_before, 2);

    let stats = ctx.run_compaction().await.unwrap();
    assert!(
        stats.chains_merged > 0,
        "should merge chains with same error+resolution"
    );

    let count_after: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 =
                conn.query_row("SELECT COUNT(*) FROM causal_chains", [], |row| row.get(0))?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(count_after, 1, "duplicate chains should be merged");
}

#[tokio::test]
async fn summarize_compresses_old_executions() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Store 55 executions of the same command
    for i in 0..55u32 {
        ctx.store(Memory::Execution(cortx_types::ExecutionRecord {
            session_id: "session-1".into(),
            task_id: None,
            command: "cargo test".into(),
            exit_code: if i % 5 == 0 { Some(1) } else { Some(0) },
            tier: cortx_types::Tier::Monitored,
            duration_ms: (1000 + i * 10) as u64,
            summary: format!("run {i}"),
            errors: vec![],
            files_touched: vec![],
        }))
        .await
        .unwrap();
    }

    let stats = ctx.run_compaction().await.unwrap();
    assert!(stats.executions_summarized > 0);

    let remaining: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 = conn.query_row(
                "SELECT COUNT(*) FROM executions WHERE command = 'cargo test'",
                [],
                |row| row.get(0),
            )?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(remaining, 10, "should keep last 10 executions");

    let summaries: i64 = ctx
        .db()
        .with_conn(|conn| {
            let c: i64 = conn.query_row(
                "SELECT COUNT(*) FROM execution_summaries WHERE command = 'cargo test'",
                [],
                |row| row.get(0),
            )?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(summaries, 1, "should have one summary row");
}

#[tokio::test]
async fn merge_keeps_highest_confidence_chain() {
    let ctx = ContextDb::in_memory().await.unwrap();

    // Insert two chains directly with controlled IDs to ensure MIN(id) would pick
    // the wrong one. "aaaa..." sorts before "zzzz..." lexicographically, so
    // MIN(id) will keep the "aaaa..." row which has LOW confidence.
    ctx.db()
        .with_conn(|conn| {
            let now = chrono::Utc::now()
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            conn.execute(
                "INSERT INTO causal_chains (id, trigger_file, trigger_error, trigger_command, resolution_file, confidence, last_verified, created_at)
                 VALUES ('aaaa-low-confidence', 'src/low.rs', 'timeout error', 'cargo test', 'src/fix.rs', 0.3, ?1, ?1)",
                [&now],
            )?;
            conn.execute(
                "INSERT INTO causal_chains (id, trigger_file, trigger_error, trigger_command, resolution_file, confidence, last_verified, created_at)
                 VALUES ('zzzz-high-confidence', 'src/high.rs', 'timeout error', 'cargo test', 'src/fix.rs', 0.9, ?1, ?1)",
                [&now],
            )?;
            Ok(())
        })
        .await
        .unwrap();

    let stats = ctx.run_compaction().await.unwrap();
    assert_eq!(stats.chains_merged, 1, "should merge one duplicate");

    // The surviving chain must be the one with confidence 0.9
    let (surviving_file, surviving_confidence): (String, f64) = ctx
        .db()
        .with_conn(|conn| {
            conn.query_row(
                "SELECT trigger_file, confidence FROM causal_chains WHERE trigger_error = 'timeout error'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(Into::into)
        })
        .await
        .unwrap();

    assert_eq!(
        surviving_file, "src/high.rs",
        "should keep chain with highest confidence"
    );
    assert!(
        (surviving_confidence - 0.9).abs() < f64::EPSILON,
        "surviving chain should have confidence 0.9, got {surviving_confidence}"
    );
}
