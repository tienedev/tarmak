use crate::config;
use anyhow::Result;
use std::path::PathBuf;

pub struct DoctorContext {
    pub claude_dir: PathBuf,
    pub cli_version: String,
    pub cli_path: PathBuf,
    pub kanwise_path: Option<PathBuf>,
}

#[derive(Debug)]
pub enum CheckResult {
    Ok(String),
    Warning(String),
}

pub fn run_doctor(ctx: &DoctorContext) -> Result<Vec<(String, CheckResult)>> {
    let results = vec![
        ("kanwise-cli".into(), check_binary(ctx)),
        ("Hook".into(), check_hook(ctx)?),
        ("MCP".into(), check_mcp(ctx)?),
        ("Plugin".into(), check_plugin(ctx)?),
        ("Components".into(), check_components(ctx)?),
    ];
    Ok(results)
}

fn check_binary(ctx: &DoctorContext) -> CheckResult {
    CheckResult::Ok(format!(
        "v{} ({})",
        ctx.cli_version,
        ctx.cli_path.display()
    ))
}

fn check_hook(ctx: &DoctorContext) -> Result<CheckResult> {
    let settings = config::read_json(&ctx.claude_dir.join("settings.json"))?;
    let has_hook = settings
        .get("hooks")
        .and_then(|h| h.get("PreToolUse"))
        .and_then(|p| p.as_array())
        .is_some_and(|arr| {
            arr.iter().any(|entry| {
                entry
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .is_some_and(|hooks| {
                        hooks.iter().any(|h| {
                            h.get("command").and_then(|c| c.as_str()) == Some("kanwise-cli hook")
                        })
                    })
            })
        });

    if has_hook {
        Ok(CheckResult::Ok("PreToolUse → kanwise-cli hook".into()))
    } else {
        Ok(CheckResult::Warning(
            "kanwise-cli hook not found in PreToolUse".into(),
        ))
    }
}

fn check_mcp(ctx: &DoctorContext) -> Result<CheckResult> {
    let mcp = config::read_json(&ctx.claude_dir.join(".mcp.json"))?;
    let has_kanwise_config = mcp
        .get("mcpServers")
        .and_then(|s| s.get("kanwise"))
        .is_some();

    match (&ctx.kanwise_path, has_kanwise_config) {
        (Some(path), true) => Ok(CheckResult::Ok(format!(
            "kanwise (binary: {})",
            path.display()
        ))),
        (Some(path), false) => Ok(CheckResult::Warning(format!(
            "kanwise binary found at {} but not configured in .mcp.json",
            path.display()
        ))),
        (None, true) => Ok(CheckResult::Warning(
            "kanwise configured but binary not found in PATH".into(),
        )),
        (None, false) => Ok(CheckResult::Warning("kanwise not configured".into())),
    }
}

fn check_plugin(ctx: &DoctorContext) -> Result<CheckResult> {
    let settings = config::read_json(&ctx.claude_dir.join("settings.json"))?;
    let has_plugin = settings
        .get("enabledPlugins")
        .and_then(|p| p.as_object())
        .is_some_and(|obj| obj.keys().any(|k| k.starts_with("kanwise-skills@")));

    if has_plugin {
        Ok(CheckResult::Ok("kanwise-skills installed".into()))
    } else {
        Ok(CheckResult::Warning("kanwise-skills not detected".into()))
    }
}

fn check_components(ctx: &DoctorContext) -> Result<CheckResult> {
    let config_path = config::cli_config_path(&ctx.claude_dir);
    let config = config::read_json(&config_path)?;

    let workspace_repo = config
        .get("workspace")
        .and_then(|w| w.get("repo"))
        .and_then(|r| r.as_str());

    // Check for at least one component key (kanwise-cli or kanwise)
    let component_names = ["kanwise-cli", "kanwise"];
    let has_any = component_names.iter().any(|name| config.get(*name).is_some());

    if !has_any {
        return Ok(CheckResult::Warning("kanwise-cli.json not found — run `kanwise-cli install`".into()));
    }

    let mut parts = vec![];
    if let Some(repo) = workspace_repo {
        parts.push(format!("workspace: {repo}"));
    }
    for name in &component_names {
        if let Some(comp) = config.get(*name) {
            let mode = comp.get("mode").and_then(|m| m.as_str()).unwrap_or("unknown");
            let detail = match mode {
                "local" => format!("{name}: local"),
                "docker" => {
                    let image = comp.get("image").and_then(|i| i.as_str()).unwrap_or("?");
                    format!("{name}: docker ({image})")
                }
                _ => format!("{name}: {mode}"),
            };
            parts.push(detail);
        }
    }

    Ok(CheckResult::Ok(parts.join(", ")))
}
