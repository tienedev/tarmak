use rtk_proxy::execute::Executor;
use std::path::PathBuf;

#[tokio::test]
async fn test_execute_simple_command() {
    let executor = Executor::new(5);
    let result = executor
        .run("echo hello", &PathBuf::from("."), &[])
        .await
        .unwrap();
    assert_eq!(result.exit_code, Some(0));
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_execute_failing_command() {
    let executor = Executor::new(5);
    let result = executor
        .run("false", &PathBuf::from("."), &[])
        .await
        .unwrap();
    assert_ne!(result.exit_code, Some(0));
}

#[tokio::test]
async fn test_execute_timeout() {
    let executor = Executor::new(1);
    let result = executor.run("sleep 10", &PathBuf::from("."), &[]).await;
    assert!(result.is_err() || result.unwrap().timed_out);
}

#[tokio::test]
async fn test_execute_with_env() {
    let executor = Executor::new(5);
    let env = vec![("TEST_VAR".to_string(), "hello_world".to_string())];
    let result = executor
        .run("printenv TEST_VAR", &PathBuf::from("."), &env)
        .await
        .unwrap();
    assert!(result.stdout.contains("hello_world"));
}
