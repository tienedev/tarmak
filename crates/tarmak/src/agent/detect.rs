use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::repo_cache::RepoCache;

/// Detect local clones for known repo URLs.
/// On macOS uses mdfind for instant Spotlight-indexed search.
/// Falls back to scanning common directories.
pub fn detect_repos(repo_urls: &[String], cache: &mut RepoCache) -> Result<()> {
    // Prune stale entries where the workdir no longer exists
    cache.retain(|_, workdir| Path::new(workdir).exists());

    let git_dirs = find_git_dirs()?;
    for git_dir in &git_dirs {
        if let Some(remote_url) = read_remote_url(git_dir) {
            let normalized = normalize_url(&remote_url);
            for target_url in repo_urls {
                if normalize_url(target_url) == normalized
                    && let Some(workdir) = git_dir.parent()
                {
                    cache.set(target_url.clone(), workdir.display().to_string());
                }
            }
        }
    }
    cache.save()?;
    Ok(())
}

fn find_git_dirs() -> Result<Vec<PathBuf>> {
    // Try mdfind first (macOS Spotlight)
    if let Ok(output) = Command::new("mdfind")
        .arg("kMDItemFSName == '.git' && kMDItemContentType == 'public.folder'")
        .output()
        && output.status.success()
    {
        let paths: Vec<PathBuf> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(PathBuf::from)
            .collect();
        if !paths.is_empty() {
            return Ok(paths);
        }
    }

    // Fallback: scan common directories
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let search_dirs = [
        home.join("Projects"),
        home.join("Projets"),
        home.join("Developer"),
        home.join("code"),
        home.join("repos"),
        home.join("src"),
    ];

    let mut results = Vec::new();
    for dir in &search_dirs {
        if dir.exists() {
            scan_for_git_dirs(dir, 3, &mut results);
        }
    }
    Ok(results)
}

fn scan_for_git_dirs(dir: &Path, max_depth: usize, results: &mut Vec<PathBuf>) {
    if max_depth == 0 {
        return;
    }
    let git_dir = dir.join(".git");
    if git_dir.exists() {
        results.push(git_dir);
        return; // Don't recurse into git repos
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.starts_with('.') && name_str != "node_modules" && name_str != "target"
                {
                    scan_for_git_dirs(&entry.path(), max_depth - 1, results);
                }
            }
        }
    }
}

fn read_remote_url(git_dir: &Path) -> Option<String> {
    let config_path = git_dir.join("config");
    let content = std::fs::read_to_string(config_path).ok()?;
    // Simple parser: find [remote "origin"] section, then url = ...
    let mut in_origin = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[remote \"origin\"]" {
            in_origin = true;
        } else if trimmed.starts_with('[') {
            in_origin = false;
        } else if in_origin && trimmed.starts_with("url = ") {
            return Some(trimmed[6..].trim().to_string());
        }
    }
    None
}

/// Normalize git URLs for comparison:
/// - Strip trailing .git
/// - Convert SSH to a canonical form
fn normalize_url(url: &str) -> String {
    let url = url.trim();
    let url = url.strip_suffix(".git").unwrap_or(url);
    // git@github.com:user/repo → github.com/user/repo
    if let Some(rest) = url.strip_prefix("git@") {
        return rest.replace(':', "/").to_lowercase();
    }
    // https://github.com/user/repo → github.com/user/repo
    if let Some(rest) = url.strip_prefix("https://") {
        return rest.to_lowercase();
    }
    if let Some(rest) = url.strip_prefix("http://") {
        return rest.to_lowercase();
    }
    url.to_lowercase()
}
