use crate::config;
use anyhow::Result;
use serde_json::{json, Value};
use std::path::Path;

// --- Types ---

pub enum HookStatus {
    Installed,
    AlreadyPresent,
    Migrated,
}

pub enum McpStatus {
    Configured,
    AlreadyPresent,
    KanwiseNotFound,
}

pub struct InstallReport {
    pub hook: HookStatus,
    pub mcp: McpStatus,
}

pub enum HookRemoveStatus {
    Removed,
    NotFound,
}

pub enum McpRemoveStatus {
    Removed,
    NotFound,
}

pub struct UninstallReport {
    pub hook: HookRemoveStatus,
    pub mcp: McpRemoveStatus,
}

// --- Install ---

pub fn install(claude_dir: &Path, kanwise_path: Option<&Path>) -> Result<InstallReport> {
    // Migrate legacy cortx.json -> kanwise-cli.json if needed
    let legacy_config = claude_dir.join("cortx.json");
    let new_config = config::cli_config_path(claude_dir);
    if legacy_config.exists() && !new_config.exists() {
        std::fs::rename(&legacy_config, &new_config)?;
    }

    let hook = install_hook(claude_dir)?;
    let mcp = install_mcp(claude_dir, kanwise_path)?;
    Ok(InstallReport { hook, mcp })
}

fn install_hook(claude_dir: &Path) -> Result<HookStatus> {
    let settings_path = claude_dir.join("settings.json");
    let mut settings = config::read_json(&settings_path)?;

    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert(json!({}));
    let pre_tool_use = hooks
        .as_object_mut()
        .unwrap()
        .entry("PreToolUse")
        .or_insert(json!([]));
    let arr = pre_tool_use.as_array_mut().unwrap();

    // Check for existing kanwise-cli hook
    if has_command_hook(arr, "kanwise-cli hook") {
        return Ok(HookStatus::AlreadyPresent);
    }

    // Check for legacy token-cleaner hook -> migrate
    if let Some(idx) = find_command_hook(arr, "token-cleaner hook") {
        arr[idx]["hooks"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .filter(|h| {
                h.get("command").and_then(|c| c.as_str()) == Some("token-cleaner hook")
            })
            .for_each(|h| h["command"] = json!("kanwise-cli hook"));
        config::write_json(&settings_path, &settings)?;
        return Ok(HookStatus::Migrated);
    }

    // Check for legacy cortx hook -> migrate
    if let Some(idx) = find_command_hook(arr, "cortx hook") {
        arr[idx]["hooks"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .filter(|h| {
                h.get("command").and_then(|c| c.as_str()) == Some("cortx hook")
            })
            .for_each(|h| h["command"] = json!("kanwise-cli hook"));
        config::write_json(&settings_path, &settings)?;
        return Ok(HookStatus::Migrated);
    }

    // Append new entry
    arr.push(json!({
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "kanwise-cli hook"}]
    }));
    config::write_json(&settings_path, &settings)?;
    Ok(HookStatus::Installed)
}

fn install_mcp(claude_dir: &Path, kanwise_path: Option<&Path>) -> Result<McpStatus> {
    if kanwise_path.is_none() {
        return Ok(McpStatus::KanwiseNotFound);
    }

    let mcp_path = claude_dir.join(".mcp.json");
    let mut mcp = config::read_json(&mcp_path)?;

    let servers = mcp
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert(json!({}));
    let servers_obj = servers.as_object_mut().unwrap();

    // Remove stale cortx serve entry // legacy
    if let Some(cli_entry) = servers_obj.get("cortx") // legacy
        && cli_entry
            .get("args")
            .and_then(|a| a.as_array())
            .is_some_and(|args| args.iter().any(|a| a.as_str() == Some("serve")))
    {
        servers_obj.remove("cortx"); // legacy
    }

    // Remove stale kanwise-cli serve entry // legacy
    if let Some(cli_entry) = servers_obj.get("kanwise-cli") // legacy
        && cli_entry
            .get("args")
            .and_then(|a| a.as_array())
            .is_some_and(|args| args.iter().any(|a| a.as_str() == Some("serve")))
    {
        servers_obj.remove("kanwise-cli"); // legacy
    }

    // Check for existing kanwise entry
    if servers_obj.contains_key("kanwise") {
        return Ok(McpStatus::AlreadyPresent);
    }

    // Add kanwise with absolute path (MCP servers may be spawned without shell PATH)
    let kanwise_bin = kanwise_path.unwrap().to_string_lossy().to_string();
    servers_obj.insert(
        "kanwise".into(),
        json!({
            "command": kanwise_bin,
            "args": ["mcp"]
        }),
    );
    config::write_json(&mcp_path, &mcp)?;
    Ok(McpStatus::Configured)
}

// --- Uninstall ---

pub fn uninstall(claude_dir: &Path) -> Result<UninstallReport> {
    let hook = uninstall_hook(claude_dir)?;
    let mcp = uninstall_mcp(claude_dir)?;
    Ok(UninstallReport { hook, mcp })
}

fn uninstall_hook(claude_dir: &Path) -> Result<HookRemoveStatus> {
    let settings_path = claude_dir.join("settings.json");
    let mut settings = config::read_json(&settings_path)?;

    let Some(hooks) = settings.get_mut("hooks") else {
        return Ok(HookRemoveStatus::NotFound);
    };
    let Some(pre_tool_use) = hooks.get_mut("PreToolUse") else {
        return Ok(HookRemoveStatus::NotFound);
    };
    let Some(arr) = pre_tool_use.as_array_mut() else {
        return Ok(HookRemoveStatus::NotFound);
    };

    let before = arr.len();
    arr.retain(|entry| !has_any_managed_hook(entry));
    let removed = arr.len() < before;

    if !removed {
        return Ok(HookRemoveStatus::NotFound);
    }

    // Cleanup empty structures
    if arr.is_empty() {
        hooks.as_object_mut().unwrap().remove("PreToolUse");
    }
    if hooks.as_object().is_some_and(|o| o.is_empty()) {
        settings.as_object_mut().unwrap().remove("hooks");
    }

    config::write_json(&settings_path, &settings)?;
    Ok(HookRemoveStatus::Removed)
}

fn uninstall_mcp(claude_dir: &Path) -> Result<McpRemoveStatus> {
    let mcp_path = claude_dir.join(".mcp.json");
    let mut mcp = config::read_json(&mcp_path)?;

    let Some(servers) = mcp.get_mut("mcpServers").and_then(|s| s.as_object_mut()) else {
        return Ok(McpRemoveStatus::NotFound);
    };

    if servers.remove("kanwise").is_none() {
        return Ok(McpRemoveStatus::NotFound);
    }

    config::write_json(&mcp_path, &mcp)?;
    Ok(McpRemoveStatus::Removed)
}

/// Check if a PreToolUse entry contains any managed hook name
/// (kanwise-cli hook, cortx hook, or token-cleaner hook).
fn has_any_managed_hook(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(|h| h.as_array())
        .is_some_and(|hooks| {
            hooks.iter().any(|h| {
                let cmd = h.get("command").and_then(|c| c.as_str()).unwrap_or("");
                cmd == "kanwise-cli hook" || cmd == "cortx hook" || cmd == "token-cleaner hook"
            })
        })
}

// --- Helpers ---

fn has_command_hook(arr: &[Value], command: &str) -> bool {
    find_command_hook(arr, command).is_some()
}

fn find_command_hook(arr: &[Value], command: &str) -> Option<usize> {
    arr.iter().position(|entry| {
        entry
            .get("hooks")
            .and_then(|h| h.as_array())
            .is_some_and(|hooks| {
                hooks
                    .iter()
                    .any(|h| h.get("command").and_then(|c| c.as_str()) == Some(command))
            })
    })
}

/// Detect component modes and write kanwise-cli.json. Called separately from install()
/// so that install() stays side-effect-free for hooks/MCP tests.
pub fn detect_and_write_config(
    claude_dir: &Path,
    workspace_root: &Path,
    system: &dyn crate::detect::SystemContext,
) -> Result<()> {
    let kanwise_mode = crate::detect::detect_kanwise(system, workspace_root);
    write_cli_config(claude_dir, workspace_root, &kanwise_mode)
}

/// Write kanwise-cli.json with detected component configurations.
fn write_cli_config(claude_dir: &Path, workspace_root: &Path, kanwise_mode: &crate::detect::ComponentMode) -> Result<()> {
    let config_path = config::cli_config_path(claude_dir);
    let mut components = json!({
        "kanwise-cli": {
            "mode": "local",
            "repo": workspace_root.to_string_lossy()
        }
    });

    match kanwise_mode {
        crate::detect::ComponentMode::Local { repo } => {
            components["kanwise"] = json!({
                "mode": "local",
                "repo": repo.to_string_lossy().to_string()
            });
        }
        crate::detect::ComponentMode::Docker { image, compose_file, service } => {
            components["kanwise"] = json!({
                "mode": "docker",
                "image": image,
                "compose_file": compose_file.to_string_lossy().to_string(),
                "service": service
            });
        }
        crate::detect::ComponentMode::BinaryOnly { path: _ } => {
            components["kanwise"] = json!({
                "mode": "local"
            });
        }
        crate::detect::ComponentMode::NotFound => {}
    }

    let config = json!({ "components": components });
    config::write_json(&config_path, &config)
}
