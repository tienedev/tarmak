use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Create a git worktree for an agent session.
/// Returns the path to the worktree directory.
pub fn create_worktree(
    repo_dir: &Path,
    session_id: &str,
    branch_name: &str,
) -> Result<PathBuf> {
    let worktree_dir = repo_dir.join(".worktrees").join(session_id);

    // Ensure .worktrees is in .gitignore
    ensure_gitignore(repo_dir)?;

    let output = Command::new("git")
        .current_dir(repo_dir)
        .args([
            "worktree",
            "add",
            &worktree_dir.display().to_string(),
            "-b",
            branch_name,
        ])
        .output()
        .context("failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {stderr}");
    }

    Ok(worktree_dir)
}

/// Remove a git worktree and its branch.
pub fn cleanup_worktree(repo_dir: &Path, session_id: &str, branch_name: &str) -> Result<()> {
    let worktree_dir = repo_dir.join(".worktrees").join(session_id);

    if worktree_dir.exists() {
        let _ = Command::new("git")
            .current_dir(repo_dir)
            .args([
                "worktree",
                "remove",
                "--force",
                &worktree_dir.display().to_string(),
            ])
            .output();
    }

    // Clean up the branch
    let _ = Command::new("git")
        .current_dir(repo_dir)
        .args(["branch", "-D", branch_name])
        .output();

    Ok(())
}

fn ensure_gitignore(repo_dir: &Path) -> Result<()> {
    let gitignore = repo_dir.join(".gitignore");
    if gitignore.exists() {
        let content = std::fs::read_to_string(&gitignore)?;
        if content.contains(".worktrees") {
            return Ok(());
        }
        let mut content = content;
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(".worktrees/\n");
        std::fs::write(&gitignore, content)?;
    } else {
        std::fs::write(&gitignore, ".worktrees/\n")?;
    }
    Ok(())
}

/// Generate a branch name from task and session IDs.
pub fn branch_name(task_id: &str, session_id: &str) -> String {
    let task_short = &task_id[..std::cmp::min(8, task_id.len())];
    let session_short = &session_id[..std::cmp::min(8, session_id.len())];
    format!("agent/{task_short}-{session_short}")
}
