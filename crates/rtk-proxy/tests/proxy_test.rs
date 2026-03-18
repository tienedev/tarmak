use cortx_types::{ActionOrgan, Command, ExecutionMode, Status};
use rtk_proxy::proxy::Proxy;
use std::path::PathBuf;

fn test_proxy() -> Proxy {
    let toml_str = include_str!("../../../policies/cortx-policy.toml");
    Proxy::from_toml(toml_str, PathBuf::from(".")).unwrap()
}

#[tokio::test]
async fn test_safe_command_executes() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo hello".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);
    assert!(result.summary.contains("hello"));
}

#[tokio::test]
async fn test_forbidden_command_blocked() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "rm -rf /".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);
}

#[tokio::test]
async fn test_admin_mode_bypasses_policy() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo admin bypass".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Admin,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Passed);
}

#[tokio::test]
async fn test_shell_operators_forbidden() {
    let proxy = test_proxy();
    let cmd = Command {
        cmd: "echo hello && echo world".to_string(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = proxy.execute(cmd).await.unwrap();
    assert_eq!(result.status, Status::Forbidden);
}
