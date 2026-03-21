use cortx::update::run_update;
use tempfile::TempDir;

fn setup_config(dir: &TempDir, config: serde_json::Value) {
    let path = cortx::config::cortx_config_path(dir.path());
    cortx::config::write_json(&path, &config).unwrap();
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
        "components": {
            "cortx": {"mode": "local", "repo": "/nonexistent"}
        }
    }));
    let results = run_update(dir.path(), Some("kanwise"), None).unwrap();
    assert_eq!(results.len(), 1);
    assert!(matches!(results[0].1, cortx::update::UpdateResult::Skipped { .. }));
}

#[test]
fn update_skips_when_repo_missing() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "components": {
            "kanwise": {"mode": "local"}
        }
    }));
    let results = run_update(dir.path(), Some("kanwise"), None).unwrap();
    assert!(matches!(results[0].1, cortx::update::UpdateResult::Skipped { .. }));
}

#[test]
fn update_ordering_kanwise_first() {
    let dir = TempDir::new().unwrap();
    setup_config(&dir, serde_json::json!({
        "components": {
            "cortx": {"mode": "local", "repo": "/nonexistent/cortx"},
            "kanwise": {"mode": "local", "repo": "/nonexistent/kanwise"}
        }
    }));
    let results = run_update(dir.path(), None, None).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].0, "kanwise");
    assert_eq!(results[1].0, "cortx");
    assert!(matches!(results[0].1, cortx::update::UpdateResult::Skipped { .. }));
    assert!(matches!(results[1].1, cortx::update::UpdateResult::Skipped { .. }));
}
