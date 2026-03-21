use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RepoCache {
    #[serde(flatten)]
    pub mappings: HashMap<String, String>,
}

impl RepoCache {
    pub fn path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".kanwise")
            .join("repo-cache.json")
    }

    pub fn load() -> Result<Self> {
        let path = Self::path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(&self.mappings)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    pub fn get(&self, repo_url: &str) -> Option<&String> {
        self.mappings.get(repo_url)
    }

    pub fn set(&mut self, repo_url: String, workdir: String) {
        self.mappings.insert(repo_url, workdir);
    }
}
