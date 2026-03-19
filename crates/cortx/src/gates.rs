use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct GateConfig {
    pub gates: Gates,
}

#[derive(Debug, Deserialize)]
pub struct Gates {
    pub tests: String,
    pub lint: String,
    pub max_diff_lines: u32,
    #[serde(default)]
    pub optional: HashMap<String, String>,
}

impl GateConfig {
    pub fn from_toml(s: &str) -> Result<Self> {
        Ok(toml::from_str(s)?)
    }
}

#[derive(Debug)]
pub struct GateResult {
    pub gate: String,
    pub passed: bool,
    pub output: String,
}
