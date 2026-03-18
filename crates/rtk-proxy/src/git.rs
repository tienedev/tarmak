use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

/// Snapshot of `git status --porcelain` output as a map of file -> status line.
pub fn status_snapshot(cwd: &Path) -> HashMap<String, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let entry = line.get(3..)?.trim();
                let filename = if let Some((_old, new)) = entry.split_once(" -> ") {
                    new.to_string()
                } else {
                    entry.to_string()
                };
                Some((filename, line.to_string()))
            })
            .collect(),
        _ => HashMap::new(),
    }
}

/// Compute files that appeared or changed between two snapshots.
pub fn diff_snapshots(
    before: &HashMap<String, String>,
    after: &HashMap<String, String>,
) -> Vec<String> {
    after
        .iter()
        .filter(|(file, status)| match before.get(*file) {
            None => true,
            Some(prev) => prev != *status,
        })
        .map(|(file, _)| file.clone())
        .collect()
}

const CHECKPOINT_MSG: &str = "cortx-checkpoint";

/// Create a git stash checkpoint. Returns true if a stash was created.
pub fn create_checkpoint(cwd: &Path) -> bool {
    // Count stashes before
    let before = Command::new("git")
        .args(["stash", "list"])
        .current_dir(cwd)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
        .unwrap_or(0);

    let _ = Command::new("git")
        .args(["stash", "push", "--include-untracked", "-m", CHECKPOINT_MSG])
        .current_dir(cwd)
        .output();

    // Count stashes after — if it grew, a stash was created
    let after = Command::new("git")
        .args(["stash", "list"])
        .current_dir(cwd)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
        .unwrap_or(0);

    after > before
}

/// Restore the most recent cortx checkpoint. Returns true if restored.
pub fn restore_checkpoint(cwd: &Path) -> bool {
    let list = Command::new("git")
        .args(["stash", "list"])
        .current_dir(cwd)
        .output();
    let stash_ref = match list {
        Ok(out) => {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .find(|l| l.contains(CHECKPOINT_MSG))
                .and_then(|l| l.split(':').next())
                .map(|s| s.to_string())
        }
        Err(_) => None,
    };
    match stash_ref {
        Some(r) => {
            Command::new("git")
                .args(["stash", "pop", &r])
                .current_dir(cwd)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
        None => false,
    }
}
