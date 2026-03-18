use anyhow::Result;
use cortx_types::Tier;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Policy {
    pub mode: ModeConfig,
    pub budget: BudgetConfig,
    pub sandbox: SandboxConfig,
    pub tiers: TierConfig,
    pub output: OutputConfig,
    pub checkpoint: CheckpointConfig,
    pub circuit_breaker: CircuitBreakerConfig,
}

#[derive(Debug, Deserialize)]
pub struct ModeConfig {
    pub default: String,
}

#[derive(Debug, Deserialize)]
pub struct BudgetConfig {
    pub max_commands_per_session: u32,
    pub max_cpu_seconds: u32,
    pub loop_threshold: u32,
    pub loop_window_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct SandboxConfig {
    pub default_timeout: String,
    pub env_passthrough: Vec<String>,
    pub env_redact: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct TierConfig {
    pub safe: Vec<String>,
    pub monitored: Vec<String>,
    pub dangerous: Vec<String>,
    pub forbidden: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct OutputConfig {
    pub max_lines: usize,
    pub keep_head: usize,
    pub keep_tail: usize,
    pub redact_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CheckpointConfig {
    pub before_monitored: bool,
    pub before_dangerous: bool,
}

#[derive(Debug, Deserialize)]
pub struct CircuitBreakerConfig {
    pub max_consecutive_failures: u32,
    pub action: String,
}

const SHELL_OPERATORS: &[&str] = &["&&", "||", ";", "|", "`", "$("];

impl Policy {
    pub fn from_toml(toml_str: &str) -> Result<Self> {
        Ok(toml::from_str(toml_str)?)
    }

    pub fn from_file(path: &str) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        Self::from_toml(&content)
    }

    pub fn classify(&self, cmd: &str) -> Tier {
        if SHELL_OPERATORS.iter().any(|op| cmd.contains(op)) {
            return Tier::Forbidden;
        }
        if self.matches_any(cmd, &self.tiers.forbidden) {
            return Tier::Forbidden;
        }
        if self.matches_any(cmd, &self.tiers.dangerous) {
            return Tier::Dangerous;
        }
        if self.matches_any(cmd, &self.tiers.monitored) {
            return Tier::Monitored;
        }
        if self.matches_any(cmd, &self.tiers.safe) {
            return Tier::Safe;
        }
        Tier::Monitored
    }

    fn matches_any(&self, cmd: &str, patterns: &[String]) -> bool {
        patterns.iter().any(|pattern| wildcard_match(pattern, cmd))
    }
}

/// Simple wildcard match where `*` matches any sequence of characters (including `/`).
/// This is intentionally different from file-glob semantics: we want `"rm -rf *"` to
/// match `"rm -rf /"` and `"sudo *"` to match `"sudo rm file"`.
fn wildcard_match(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let mut pos = 0;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            // First segment must match at the start
            if !text.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == parts.len() - 1 {
            // Last segment must match at the end
            if !text[pos..].ends_with(part) {
                return false;
            }
            pos = text.len();
        } else {
            // Middle segments: find next occurrence
            if let Some(found) = text[pos..].find(part) {
                pos += found + part.len();
            } else {
                return false;
            }
        }
    }
    true
}
