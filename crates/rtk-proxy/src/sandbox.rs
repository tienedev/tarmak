use anyhow::{Result, bail};
use std::path::{Path, PathBuf};

use crate::policy::SandboxConfig;

pub struct Sandbox {
    project_root: PathBuf,
    timeout_secs: u64,
    env_passthrough: Vec<String>,
    env_redact_patterns: Vec<String>,
}

impl Sandbox {
    pub fn new(config: &SandboxConfig, project_root: PathBuf) -> Self {
        let timeout_secs = parse_duration_secs(&config.default_timeout).unwrap_or(30);
        Self {
            project_root,
            timeout_secs,
            env_passthrough: config.env_passthrough.clone(),
            env_redact_patterns: config.env_redact.clone(),
        }
    }

    pub fn validate_cwd(&self, cwd: &Path) -> Result<()> {
        // Normalize both paths: resolve ".." components without requiring filesystem access
        let canonical_root = normalize_path(&self.project_root);
        let canonical_cwd = normalize_path(cwd);
        if !canonical_cwd.starts_with(&canonical_root) {
            bail!(
                "cwd escape: {} is outside project root {}",
                canonical_cwd.display(),
                canonical_root.display()
            );
        }
        Ok(())
    }

    pub fn filter_env(&self, env: &[(String, String)]) -> Vec<(String, String)> {
        env.iter()
            .filter(|(key, _)| self.env_passthrough.contains(key) && !self.matches_redact(key))
            .cloned()
            .collect()
    }

    pub fn timeout_secs(&self) -> u64 {
        self.timeout_secs
    }

    #[allow(dead_code)]
    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    fn matches_redact(&self, key: &str) -> bool {
        self.env_redact_patterns
            .iter()
            .any(|pattern| glob_match::glob_match(pattern, key))
    }
}

/// Normalize a path by resolving `.` and `..` components lexically (no filesystem access).
fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                components.pop();
            }
            std::path::Component::CurDir => {}
            other => components.push(other),
        }
    }
    components.iter().collect()
}

fn parse_duration_secs(s: &str) -> Option<u64> {
    let s = s.trim();
    if let Some(secs) = s.strip_suffix('s') {
        secs.parse().ok()
    } else if let Some(mins) = s.strip_suffix('m') {
        mins.parse::<u64>().ok().map(|m| m * 60)
    } else {
        s.parse().ok()
    }
}
