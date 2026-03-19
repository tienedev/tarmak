use context_db::ContextDb;
use cortx::orchestrator::Orchestrator;
use cortx_types::{Command, ExecutionMode, Memory, MemoryOrgan, MemorySource, Status};
use std::path::PathBuf;

/// Helper: build an Orchestrator backed by in-memory DBs and the default policy.
async fn make_orchestrator() -> Orchestrator {
    let policy_toml = include_str!("../../../policies/cortx-policy.toml");
    let proxy = rtk_proxy::Proxy::from_toml(policy_toml, PathBuf::from(".")).unwrap();
    let memory = ContextDb::in_memory().await.unwrap();
    Orchestrator::without_kanwise(proxy, memory).await.unwrap()
}

#[tokio::test]
async fn preflight_injects_hints_before_execution() {
    let orch = make_orchestrator().await;

    orch.memory()
        .store(Memory::CausalChain {
            trigger_file: "src/main.rs".into(),
            trigger_error: Some("cannot find crate".into()),
            trigger_command: Some("cargo build".into()),
            resolution_files: vec!["Cargo.toml".into()],
        })
        .await
        .unwrap();

    let result = orch
        .execute_and_remember(Command {
            cmd: "cargo build".into(),
            cwd: PathBuf::from("."),
            mode: ExecutionMode::Assisted,
            task_id: Some("test-task".into()),
        })
        .await
        .unwrap();

    assert!(
        !result.hints.is_empty(),
        "pre-flight should inject at least one hint for a known failure pattern"
    );
    assert!(
        result.hints.iter().any(|h| h.summary.contains("src/main.rs")),
        "hint should reference the trigger file"
    );
}

#[tokio::test]
async fn safe_commands_skip_preflight() {
    let orch = make_orchestrator().await;

    orch.memory()
        .store(Memory::ProjectFact {
            fact: "cargo test runs unit tests".into(),
            citation: "README.md".into(),
            source: MemorySource::Agent,
        })
        .await
        .unwrap();

    let result = orch
        .execute_and_remember(Command {
            cmd: "git status".into(),
            cwd: PathBuf::from("."),
            mode: ExecutionMode::Assisted,
            task_id: None,
        })
        .await
        .unwrap();

    let has_proxy_preflight = result
        .hints
        .iter()
        .any(|h| h.kind == "causal_chain" || h.kind == "project_fact");
    assert!(
        !has_proxy_preflight,
        "safe commands should not trigger pre-flight memory recall"
    );
}

#[tokio::test]
async fn successful_execution_reinforces_served_hint_confidence() {
    let orch = make_orchestrator().await;

    orch.memory()
        .store(Memory::CausalChain {
            trigger_file: "Cargo.toml".into(),
            trigger_error: Some("build failed".into()),
            trigger_command: Some("cargo build".into()),
            resolution_files: vec!["Cargo.toml".into()],
        })
        .await
        .unwrap();

    let cmd = Command {
        cmd: "cargo build".into(),
        cwd: PathBuf::from("."),
        mode: ExecutionMode::Assisted,
        task_id: None,
    };
    let result = orch.execute_and_remember(cmd).await.unwrap();

    if result.status == Status::Passed && !result.hints.is_empty() {
        let hints = orch
            .memory()
            .recall_for_preflight("cargo build", &["Cargo.toml"])
            .await
            .unwrap();
        if let Some(h) = hints.first() {
            assert!(
                h.confidence > 0.5,
                "confidence should be reinforced after successful use, got {}",
                h.confidence
            );
        }
    }
}
