use kanwise_cli::update::run_update;
use tempfile::TempDir;

fn setup_config(dir: &TempDir, config: serde_json::Value) {
    let path = kanwise_cli::config::cli_config_path(dir.path());
    kanwise_cli::config::write_json(&path, &config).unwrap();
}

#[test]
fn update_fails_without_config() {
    let dir = TempDir::new().unwrap();
    let result = run_update(dir.path(), None, None);
    assert!(result.is_err());
}

#[test]
fn update_skips_unknown_component() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "workspace": {"repo": "/nonexistent"},
        "kanwise-cli": {"mode": "local"}
    }));
    let results = run_update(dir.path(), Some("kanwise"), None).unwrap();
    assert_eq!(results.len(), 1);
    assert!(matches!(results[0].1, kanwise_cli::update::UpdateResult::Skipped { .. }));
}

#[test]
fn update_skips_when_repo_missing() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "kanwise": {"mode": "local"}
    }));
    let results = run_update(dir.path(), Some("kanwise"), None).unwrap();
    assert!(matches!(results[0].1, kanwise_cli::update::UpdateResult::Skipped { .. }));
}

#[test]
fn update_ordering_kanwise_first() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "workspace": {"repo": "/nonexistent"},
        "kanwise-cli": {"mode": "local"},
        "kanwise": {"mode": "local"}
    }));
    let results = run_update(dir.path(), None, None).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].0, "kanwise");
    assert_eq!(results[1].0, "kanwise-cli");
    // Both should be skipped because /nonexistent isn't a valid git repo
    assert!(matches!(results[0].1, kanwise_cli::update::UpdateResult::Skipped { .. }));
    assert!(matches!(results[1].1, kanwise_cli::update::UpdateResult::Skipped { .. }));
}

#[test]
fn update_docker_component_skips_without_compose() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "workspace": {"repo": "/nonexistent"},
        "kanwise": {"mode": "docker"}
    }));
    let results = run_update(dir.path(), Some("kanwise"), None).unwrap();
    assert_eq!(results.len(), 1);
    match &results[0].1 {
        kanwise_cli::update::UpdateResult::Skipped { reason } => {
            assert!(reason.contains("compose_file not configured"));
        }
        other => panic!("expected Skipped, got {:?}", other),
    }
}
