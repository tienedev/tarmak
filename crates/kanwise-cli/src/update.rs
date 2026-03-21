use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

#[derive(Debug)]
pub enum UpdateResult {
    Updated { old_ref: String, new_ref: String },
    AlreadyUpToDate { current_ref: String },
    Skipped { reason: String },
}

/// Run a git command in the given repo, returning stdout as string.
fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git {} failed: {}", args.join(" "), stderr.trim());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if repo has uncommitted changes.
pub fn check_dirty(repo: &Path) -> Result<bool> {
    let status = git(repo, &["status", "--porcelain"])?;
    Ok(!status.is_empty())
}

/// Get the current short commit hash.
pub fn current_commit(repo: &Path) -> Result<String> {
    git(repo, &["rev-parse", "--short", "HEAD"])
}

/// Pull latest changes from remote.
pub fn git_pull(repo: &Path) -> Result<()> {
    git(repo, &["pull"])?;
    Ok(())
}

/// Run cargo install for a crate within a workspace.
pub fn cargo_install(repo: &Path, crate_name: &str) -> Result<()> {
    let crate_path = repo.join("crates").join(crate_name);
    let output = Command::new("cargo")
        .args(["install", "--path"])
        .arg(&crate_path)
        .output()
        .context("failed to run cargo install")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("cargo install failed:\n{}", stderr);
    }
    Ok(())
}

/// Update a local component: pre-flight check, git pull, cargo install.
pub fn update_local(repo: &Path, crate_name: &str) -> Result<UpdateResult> {
    if check_dirty(repo)? {
        return Ok(UpdateResult::Skipped {
            reason: format!(
                "repo has uncommitted changes at {} — commit or stash first",
                repo.display()
            ),
        });
    }

    let old = current_commit(repo)?;
    git_pull(repo)?;
    let new = current_commit(repo)?;

    if old == new {
        return Ok(UpdateResult::AlreadyUpToDate { current_ref: old });
    }

    cargo_install(repo, crate_name)?;
    Ok(UpdateResult::Updated { old_ref: old, new_ref: new })
}

/// Update a docker component: docker compose pull + up.
pub fn update_docker(compose_file: &Path, service: &str) -> Result<UpdateResult> {
    let old_digest = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["images", "-q", service])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let pull = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["pull", service])
        .output()
        .context("failed to run docker compose pull")?;
    if !pull.status.success() {
        let stderr = String::from_utf8_lossy(&pull.stderr);
        bail!("docker compose pull failed:\n{}", stderr);
    }

    let up = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["up", "-d", service])
        .output()
        .context("failed to run docker compose up")?;
    if !up.status.success() {
        let stderr = String::from_utf8_lossy(&up.stderr);
        bail!("docker compose up failed:\n{}", stderr);
    }

    let new_digest = Command::new("docker")
        .args(["compose", "-f"])
        .arg(compose_file)
        .args(["images", "-q", service])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if old_digest == new_digest && !old_digest.is_empty() {
        Ok(UpdateResult::AlreadyUpToDate { current_ref: old_digest })
    } else {
        Ok(UpdateResult::Updated {
            old_ref: if old_digest.is_empty() { "none".into() } else { old_digest },
            new_ref: if new_digest.is_empty() { "unknown".into() } else { new_digest },
        })
    }
}

/// Read kanwise-cli.json and run updates for the specified component(s).
///
/// New config schema (monorepo model):
/// ```json
/// {
///   "workspace": {"repo": "/path/to/kanwise"},
///   "kanwise-cli": {"mode": "local"},
///   "kanwise": {"mode": "local"}
/// }
/// ```
///
/// All local components share a single workspace repo. One git pull, then
/// cargo install per requested crate.
pub fn run_update(
    claude_dir: &Path,
    component: Option<&str>,
    force_mode: Option<&str>,
) -> Result<Vec<(String, UpdateResult)>> {
    let config_path = crate::config::cli_config_path(claude_dir);
    let config = crate::config::read_json(&config_path)?;

    let workspace_repo = config
        .get("workspace")
        .and_then(|w| w.get("repo"))
        .and_then(|r| r.as_str());

    // Determine which components to update (kanwise first, kanwise-cli last)
    let targets: Vec<&str> = match component {
        Some(name) => vec![name],
        None => {
            let mut t = vec![];
            if config.get("kanwise").is_some() { t.push("kanwise"); }
            if config.get("kanwise-cli").is_some() { t.push("kanwise-cli"); }
            if t.is_empty() {
                bail!("kanwise-cli.json not found or empty — run `kanwise-cli install` first");
            }
            t
        }
    };

    // Check if any local components are targeted — if so, we need the workspace repo
    let has_local_targets = targets.iter().any(|name| {
        let mode = force_mode.unwrap_or_else(|| {
            config.get(*name)
                .and_then(|c| c.get("mode"))
                .and_then(|m| m.as_str())
                .unwrap_or("local")
        });
        mode == "local"
    });

    // Single git pull for the shared workspace repo (if needed)
    let pull_result: Option<Result<(String, String), String>> = if has_local_targets {
        match workspace_repo {
            Some(repo) => {
                let repo_path = Path::new(repo);
                match check_dirty(repo_path) {
                    Err(e) => Some(Err(e.to_string())),
                    Ok(true) => Some(Err(format!(
                        "repo has uncommitted changes at {} — commit or stash first",
                        repo_path.display()
                    ))),
                    Ok(false) => {
                        match current_commit(repo_path) {
                            Err(e) => Some(Err(e.to_string())),
                            Ok(old) => {
                                if let Err(e) = git_pull(repo_path) {
                                    Some(Err(e.to_string()))
                                } else {
                                    match current_commit(repo_path) {
                                        Err(e) => Some(Err(e.to_string())),
                                        Ok(new) => Some(Ok((old, new))),
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None => Some(Err(
                "workspace.repo not configured — use `kanwise-cli update --set-repo /path`".into()
            )),
        }
    } else {
        None
    };

    let mut results = vec![];
    for name in targets {
        let comp = config.get(name);
        if comp.is_none() {
            results.push((name.to_string(), UpdateResult::Skipped {
                reason: format!("{name} not configured in kanwise-cli.json"),
            }));
            continue;
        }
        let comp = comp.unwrap();

        let mode = force_mode
            .unwrap_or_else(|| comp.get("mode").and_then(|m| m.as_str()).unwrap_or("local"));

        let result = match mode {
            "local" => {
                match &pull_result {
                    Some(Ok((old, new))) => {
                        if old == new {
                            Ok(UpdateResult::AlreadyUpToDate { current_ref: old.clone() })
                        } else {
                            let repo_path = Path::new(workspace_repo.unwrap());
                            match cargo_install(repo_path, name) {
                                Ok(()) => Ok(UpdateResult::Updated {
                                    old_ref: old.clone(),
                                    new_ref: new.clone(),
                                }),
                                Err(e) => Ok(UpdateResult::Skipped {
                                    reason: format!("cargo install failed: {e}"),
                                }),
                            }
                        }
                    }
                    Some(Err(reason)) => Ok(UpdateResult::Skipped {
                        reason: reason.clone(),
                    }),
                    None => Ok(UpdateResult::Skipped {
                        reason: "no workspace repo configured".into(),
                    }),
                }
            }
            "docker" => {
                let compose = comp.get("compose_file").and_then(|c| c.as_str());
                let service = comp.get("service").and_then(|s| s.as_str()).unwrap_or(name);
                match compose {
                    Some(f) => update_docker(f.as_ref(), service),
                    None => Ok(UpdateResult::Skipped {
                        reason: format!("{name} compose_file not configured"),
                    }),
                }
            }
            other => Ok(UpdateResult::Skipped {
                reason: format!("unknown mode '{other}' for {name}"),
            }),
        };

        let result = match result {
            Ok(r) => r,
            Err(e) => UpdateResult::Skipped { reason: e.to_string() },
        };
        results.push((name.to_string(), result));
    }

    Ok(results)
}
