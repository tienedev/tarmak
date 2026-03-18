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
