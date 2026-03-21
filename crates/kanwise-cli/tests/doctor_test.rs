use cortx::doctor::{run_doctor, CheckResult, DoctorContext};
use std::path::PathBuf;
use tempfile::TempDir;

fn make_context(dir: &TempDir) -> DoctorContext {
    DoctorContext {
        claude_dir: dir.path().to_path_buf(),
        cortx_version: "0.1.0".into(),
        cortx_path: PathBuf::from("/usr/local/bin/cortx"),
        kanwise_path: None,
    }
}

#[test]
fn binary_check_always_ok() {
    let dir = TempDir::new().unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (name, status) = &results[0];
    assert_eq!(name, "cortx");
    assert!(matches!(status, CheckResult::Ok(_)));
}

#[test]
fn hook_check_warns_when_missing() {
    let dir = TempDir::new().unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (name, status) = &results[1];
    assert_eq!(name, "Hook");
    assert!(matches!(status, CheckResult::Warning(_)));
}

#[test]
fn hook_check_ok_when_installed() {
    let dir = TempDir::new().unwrap();
    cortx::install::install(dir.path(), None).unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (_, status) = &results[1];
    assert!(matches!(status, CheckResult::Ok(_)));
}

#[test]
fn mcp_check_warns_when_kanwise_not_in_path() {
    let dir = TempDir::new().unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (name, status) = &results[2];
    assert_eq!(name, "MCP");
    assert!(matches!(status, CheckResult::Warning(_)));
}

#[test]
fn mcp_check_ok_when_configured_and_found() {
    let dir = TempDir::new().unwrap();
    let kanwise = PathBuf::from("/usr/local/bin/kanwise");
    cortx::install::install(dir.path(), Some(kanwise.as_path())).unwrap();
    let ctx = DoctorContext {
        claude_dir: dir.path().to_path_buf(),
        cortx_version: "0.1.0".into(),
        cortx_path: PathBuf::from("/usr/local/bin/cortx"),
        kanwise_path: Some(kanwise),
    };
    let results = run_doctor(&ctx).unwrap();
    let (_, status) = &results[2];
    assert!(matches!(status, CheckResult::Ok(_)));
}

#[test]
fn plugin_check_warns_when_missing() {
    let dir = TempDir::new().unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (name, status) = &results[3];
    assert_eq!(name, "Plugin");
    assert!(matches!(status, CheckResult::Warning(_)));
}

#[test]
fn plugin_check_ok_when_present() {
    let dir = TempDir::new().unwrap();
    let settings = serde_json::json!({
        "enabledPlugins": {
            "kanwise-skills@tienedev/kanwise-skills": true
        }
    });
    cortx::config::write_json(&dir.path().join("settings.json"), &settings).unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let (_, status) = &results[3];
    assert!(matches!(status, CheckResult::Ok(_)));
}

#[test]
fn doctor_shows_component_info_from_cortx_json() {
    let dir = TempDir::new().unwrap();
    // Write cortx.json directly (no install() call — avoids RealSystem side effects)
    let config = serde_json::json!({
        "components": {
            "cortx": {"mode": "local", "repo": "/some/path/cortx"},
            "kanwise": {"mode": "docker", "image": "ghcr.io/tienedev/kanwise:latest"}
        }
    });
    cortx::config::write_json(&cortx::config::cortx_config_path(dir.path()), &config).unwrap();

    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let comp_check = results.iter().find(|(name, _)| name == "Components");
    assert!(comp_check.is_some(), "should have Components check");
    match &comp_check.unwrap().1 {
        CheckResult::Ok(msg) => {
            assert!(msg.contains("cortx: local"), "should show cortx mode");
            assert!(msg.contains("kanwise: docker"), "should show kanwise mode");
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn doctor_warns_when_cortx_json_missing() {
    let dir = TempDir::new().unwrap();
    let ctx = make_context(&dir);
    let results = run_doctor(&ctx).unwrap();
    let comp_check = results.iter().find(|(name, _)| name == "Components");
    assert!(comp_check.is_some());
    assert!(matches!(comp_check.unwrap().1, CheckResult::Warning(_)));
}
