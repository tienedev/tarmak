use cortx_types::{Command, ExecutionMode, Status};
use std::path::PathBuf;

#[tokio::test]
async fn test_full_execute_and_remember_flow() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory)
        .await
        .unwrap();

    let cmd = Command {
        cmd: "echo integration test".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: Some("task-1".to_string()),
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_forbidden_command_still_stored() {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = context_db::ContextDb::in_memory().await.unwrap();
    let orch = cortx::orchestrator::Orchestrator::without_kanwise(proxy, memory)
        .await
        .unwrap();

    let cmd = Command {
        cmd: "rm -rf /".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);
    let count = orch.memory().execution_count().await.unwrap();
    assert_eq!(count, 1);
}
