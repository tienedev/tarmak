use kanwise_cli::install::{install, uninstall, HookRemoveStatus, HookStatus, McpRemoveStatus, McpStatus};
use kanwise_cli::detect::SystemContext;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn setup() -> TempDir {
    TempDir::new().unwrap()
}

fn read(dir: &TempDir, name: &str) -> serde_json::Value {
    let path = dir.path().join(name);
    kanwise_cli::config::read_json(&path).unwrap()
}

// --- Hook installation ---

#[test]
fn fresh_install_creates_hook() {
    let dir = setup();
    let report = install(dir.path(), None).unwrap();
    assert!(matches!(report.hook, HookStatus::Installed));

    let settings = read(&dir, "settings.json");
    let hooks = &settings["hooks"]["PreToolUse"];
    assert!(hooks.is_array());
    let arr = hooks.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["hooks"][0]["command"], "kanwise-cli hook");
    assert_eq!(arr[0]["matcher"], "Bash");
}

#[test]
fn idempotent_hook_skips_when_present() {
    let dir = setup();
    install(dir.path(), None).unwrap();
    let report = install(dir.path(), None).unwrap();
    assert!(matches!(report.hook, HookStatus::AlreadyPresent));

    let settings = read(&dir, "settings.json");
    let arr = settings["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr.len(), 1, "should not duplicate");
}

#[test]
fn migrates_token_cleaner_hook() {
    let dir = setup();
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "Bash",
                "hooks": [{"type": "command", "command": "token-cleaner hook"}]
            }]
        }
    });
    kanwise_cli::config::write_json(&dir.path().join("settings.json"), &settings).unwrap();

    let report = install(dir.path(), None).unwrap();
    assert!(matches!(report.hook, HookStatus::Migrated));

    let updated = read(&dir, "settings.json");
    let arr = updated["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["hooks"][0]["command"], "kanwise-cli hook");
}

#[test]
fn preserves_other_hooks() {
    let dir = setup();
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "Write",
                "hooks": [{"type": "command", "command": "other-tool"}]
            }]
        },
        "unrelated_key": "keep me"
    });
    kanwise_cli::config::write_json(&dir.path().join("settings.json"), &settings).unwrap();

    install(dir.path(), None).unwrap();

    let updated = read(&dir, "settings.json");
    assert_eq!(updated["unrelated_key"], "keep me");
    let arr = updated["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr.len(), 2, "should append, not replace");
}

// --- MCP installation ---

#[test]
fn mcp_skipped_when_kanwise_not_found() {
    let dir = setup();
    let report = install(dir.path(), None).unwrap();
    assert!(matches!(report.mcp, McpStatus::KanwiseNotFound));
}

#[test]
fn mcp_configured_when_kanwise_found() {
    let dir = setup();
    let kanwise = dir.path().join("kanwise"); // fake path
    let report = install(dir.path(), Some(kanwise.as_path())).unwrap();
    assert!(matches!(report.mcp, McpStatus::Configured));

    let mcp = read(&dir, ".mcp.json");
    // command is the absolute path passed as kanwise_path
    assert_eq!(mcp["mcpServers"]["kanwise"]["command"], kanwise.to_string_lossy().to_string());
    assert_eq!(mcp["mcpServers"]["kanwise"]["args"][0], "mcp");
}

#[test]
fn mcp_idempotent_when_kanwise_present() {
    let dir = setup();
    let kanwise = dir.path().join("kanwise");
    install(dir.path(), Some(kanwise.as_path())).unwrap();
    let report = install(dir.path(), Some(kanwise.as_path())).unwrap();
    assert!(matches!(report.mcp, McpStatus::AlreadyPresent));
}

#[test]
fn mcp_removes_stale_cli_serve_entry() {
    let dir = setup();
    let mcp = serde_json::json!({
        "mcpServers": {
            "cortx": {"command": "cortx", "args": ["serve"]}, // legacy
            "other": {"command": "other-tool"}
        }
    });
    kanwise_cli::config::write_json(&dir.path().join(".mcp.json"), &mcp).unwrap();

    let kanwise = dir.path().join("kanwise");
    install(dir.path(), Some(kanwise.as_path())).unwrap();

    let updated = read(&dir, ".mcp.json");
    assert!(updated["mcpServers"]["cortx"].is_null(), "stale cortx entry removed"); // legacy
    assert_eq!(updated["mcpServers"]["other"]["command"], "other-tool", "other entries preserved");
    assert_eq!(updated["mcpServers"]["kanwise"]["command"], kanwise.to_string_lossy().to_string(), "kanwise added with absolute path");
}

// --- Hook uninstall ---

#[test]
fn uninstall_removes_cli_hook() {
    let dir = setup();
    install(dir.path(), None).unwrap();
    let report = uninstall(dir.path()).unwrap();
    assert!(matches!(report.hook, HookRemoveStatus::Removed));

    let settings = read(&dir, "settings.json");
    // hooks key should be fully removed (was the only entry)
    assert!(settings.get("hooks").is_none() || settings["hooks"].is_null());
}

#[test]
fn uninstall_removes_legacy_token_cleaner_hook() {
    let dir = setup();
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": "Bash",
                "hooks": [{"type": "command", "command": "token-cleaner hook"}]
            }]
        }
    });
    kanwise_cli::config::write_json(&dir.path().join("settings.json"), &settings).unwrap();

    let report = uninstall(dir.path()).unwrap();
    assert!(matches!(report.hook, HookRemoveStatus::Removed));
}

#[test]
fn uninstall_preserves_other_hooks() {
    let dir = setup();
    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [
                {"matcher": "Write", "hooks": [{"type": "command", "command": "other"}]},
                {"matcher": "Bash", "hooks": [{"type": "command", "command": "kanwise-cli hook"}]}
            ]
        }
    });
    kanwise_cli::config::write_json(&dir.path().join("settings.json"), &settings).unwrap();

    uninstall(dir.path()).unwrap();

    let updated = read(&dir, "settings.json");
    let arr = updated["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["hooks"][0]["command"], "other");
}

#[test]
fn uninstall_hook_not_found() {
    let dir = setup();
    let report = uninstall(dir.path()).unwrap();
    assert!(matches!(report.hook, HookRemoveStatus::NotFound));
}

// --- MCP uninstall ---

#[test]
fn uninstall_removes_kanwise_mcp() {
    let dir = setup();
    let kanwise = dir.path().join("kanwise");
    install(dir.path(), Some(kanwise.as_path())).unwrap();

    let report = uninstall(dir.path()).unwrap();
    assert!(matches!(report.mcp, McpRemoveStatus::Removed));

    let mcp = read(&dir, ".mcp.json");
    assert!(mcp["mcpServers"]["kanwise"].is_null());
}

#[test]
fn uninstall_mcp_not_found() {
    let dir = setup();
    let report = uninstall(dir.path()).unwrap();
    assert!(matches!(report.mcp, McpRemoveStatus::NotFound));
}

// --- detect_and_write_config ---

/// Mock system that detects a sibling kanwise repo.
struct MockSiblingSystem {
    cli_repo: PathBuf,
}
impl SystemContext for MockSiblingSystem {
    fn docker_running(&self, _name: &str) -> Option<String> { None }
    fn path_exists(&self, path: &Path) -> bool {
        path == self.cli_repo.parent().unwrap().join("kanwise").join("Cargo.toml")
    }
    fn which(&self, _name: &str) -> Option<PathBuf> { None }
    fn find_compose_file(&self, _near: &Path) -> Option<PathBuf> { None }
}

#[test]
fn detect_and_write_config_writes_cli_json() {
    let dir = setup();
    let cli_repo = PathBuf::from("/proj/kanwise-cli");
    let mock = MockSiblingSystem { cli_repo: cli_repo.clone() };
    kanwise_cli::install::detect_and_write_config(dir.path(), &cli_repo, &mock).unwrap();

    let config_path = kanwise_cli::config::cli_config_path(dir.path());
    let config = kanwise_cli::config::read_json(&config_path).unwrap();
    assert!(config.get("components").is_some());
    assert_eq!(config["components"]["kanwise-cli"]["mode"], "local");
    assert_eq!(config["components"]["kanwise-cli"]["repo"], "/proj/kanwise-cli");
    assert_eq!(config["components"]["kanwise"]["mode"], "local");
    assert_eq!(config["components"]["kanwise"]["repo"], "/proj/kanwise");
}
