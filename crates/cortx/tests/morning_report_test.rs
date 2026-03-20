use std::path::PathBuf;

#[tokio::test]
async fn morning_report_summarizes_session() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory)
        .await
        .unwrap();

    let report = orch.generate_morning_report(None).await.unwrap();
    assert!(report.contains("Session"));
    assert!(report.contains("0 commands"));

    // Verify report was stored in context-db
    let count: i64 = orch
        .memory()
        .db()
        .with_conn(|conn| {
            let c: i64 =
                conn.query_row("SELECT COUNT(*) FROM session_reports", [], |row| row.get(0))?;
            Ok(c)
        })
        .await
        .unwrap();
    assert_eq!(count, 1, "report should be stored in session_reports");
}
