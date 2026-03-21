use kanwise_cli::config::{cli_config_path, read_json, write_json};
use tempfile::TempDir;

#[test]
fn read_missing_file_returns_empty_object() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("does-not-exist.json");
    let result = read_json(&path).unwrap();
    assert_eq!(result, serde_json::json!({}));
}

#[test]
fn read_valid_json() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.json");
    std::fs::write(&path, r#"{"key": "value"}"#).unwrap();
    let result = read_json(&path).unwrap();
    assert_eq!(result["key"], "value");
}

#[test]
fn read_malformed_json_returns_error() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("bad.json");
    std::fs::write(&path, "not json {{{").unwrap();
    let result = read_json(&path);
    assert!(result.is_err());
}

#[test]
fn write_creates_parent_dirs() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sub").join("dir").join("test.json");
    write_json(&path, &serde_json::json!({"a": 1})).unwrap();
    assert!(path.exists());
    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["a"], 1);
}

#[test]
fn write_is_atomic_no_tmp_leftover() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.json");
    write_json(&path, &serde_json::json!({"x": true})).unwrap();
    assert!(path.exists());
    let tmp_path = dir.path().join("test.json.tmp");
    assert!(!tmp_path.exists(), "temp file should be cleaned up");
}

#[test]
fn write_pretty_prints() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.json");
    write_json(&path, &serde_json::json!({"a": 1, "b": 2})).unwrap();
    let content = std::fs::read_to_string(&path).unwrap();
    assert!(content.contains('\n'), "output should be pretty-printed");
}

#[test]
fn write_roundtrip_preserves_data() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("test.json");
    let data = serde_json::json!({
        "hooks": {"PreToolUse": []},
        "unrelated": "preserve me"
    });
    write_json(&path, &data).unwrap();
    let result = read_json(&path).unwrap();
    assert_eq!(result, data);
}

#[test]
fn cli_config_path_joins_correctly() {
    let dir = TempDir::new().unwrap();
    let path = cli_config_path(dir.path());
    assert_eq!(path, dir.path().join("kanwise-cli.json"));
}

#[test]
fn cli_config_roundtrip() {
    let dir = TempDir::new().unwrap();
    let path = cli_config_path(dir.path());
    let data = serde_json::json!({
        "workspace": {"repo": "/some/path"},
        "kanwise-cli": {"mode": "local"}
    });
    write_json(&path, &data).unwrap();
    let result = read_json(&path).unwrap();
    assert_eq!(result, data);
}

#[test]
fn cli_config_missing_returns_empty() {
    let dir = TempDir::new().unwrap();
    let path = cli_config_path(dir.path());
    let result = read_json(&path).unwrap();
    assert_eq!(result, serde_json::json!({}));
}
