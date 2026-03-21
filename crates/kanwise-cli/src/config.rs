use anyhow::{Context, Result};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Returns the default Claude Code config directory (~/.claude/).
pub fn claude_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join(".claude")
}

/// Read a JSON file. Returns empty object `{}` if file does not exist.
/// Returns error if file exists but contains malformed JSON.
pub fn read_json(path: &Path) -> Result<Value> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let value = serde_json::from_str(&content)
        .with_context(|| format!("malformed JSON in {}", path.display()))?;
    Ok(value)
}

/// Write a JSON value to a file with atomic write (temp + rename).
/// Creates parent directories if needed. Pretty-prints the JSON.
pub fn write_json(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value)?;
    // Atomic write: append .tmp to full path (not with_extension which replaces)
    let mut tmp_name = path.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    let mut file = fs::File::create(&tmp_path)
        .with_context(|| format!("failed to create temp file {}", tmp_path.display()))?;
    file.write_all(content.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&tmp_path, path).with_context(|| {
        format!(
            "failed to rename {} -> {}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}

/// Returns the path to the CLI's own config file within the Claude dir.
pub fn cli_config_path(claude_dir: &Path) -> PathBuf {
    claude_dir.join("kanwise-cli.json")
}
