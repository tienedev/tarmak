use rtk_proxy::git;
use std::process::Command;
use tempfile::TempDir;

#[test]
fn test_git_status_snapshot() {
    let dir = TempDir::new().unwrap();
    Command::new("git")
        .args(["init"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.email", "test@test.com"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["config", "user.name", "test"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
    Command::new("git")
        .args(["add", "."])
        .current_dir(dir.path())
        .output()
        .unwrap();
    Command::new("git")
        .args(["commit", "-m", "init"])
        .current_dir(dir.path())
        .output()
        .unwrap();

    let before = git::status_snapshot(dir.path());
    std::fs::write(dir.path().join("b.txt"), "new file").unwrap();
    std::fs::write(dir.path().join("a.txt"), "modified").unwrap();
    let after = git::status_snapshot(dir.path());

    let touched = git::diff_snapshots(&before, &after);
    assert!(touched.contains(&"b.txt".to_string()));
    assert!(touched.contains(&"a.txt".to_string()));
}

#[test]
fn test_git_status_snapshot_non_git_dir() {
    let dir = TempDir::new().unwrap();
    let snapshot = git::status_snapshot(dir.path());
    assert!(snapshot.is_empty());
}
