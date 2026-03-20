use rtk_proxy::git;
use std::process::Command;
use tempfile::TempDir;

#[tokio::test]
async fn test_git_status_snapshot() {
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

    let before = git::status_snapshot(dir.path()).await;
    std::fs::write(dir.path().join("b.txt"), "new file").unwrap();
    std::fs::write(dir.path().join("a.txt"), "modified").unwrap();
    let after = git::status_snapshot(dir.path()).await;

    let touched = git::diff_snapshots(&before, &after);
    assert!(touched.contains(&"b.txt".to_string()));
    assert!(touched.contains(&"a.txt".to_string()));
}

#[tokio::test]
async fn test_git_status_snapshot_non_git_dir() {
    let dir = TempDir::new().unwrap();
    let snapshot = git::status_snapshot(dir.path()).await;
    assert!(snapshot.is_empty());
}

#[tokio::test]
async fn test_create_checkpoint() {
    let dir = TempDir::new().unwrap();
    Command::new("git").args(["init"]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.email", "test@test.com"]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.name", "test"]).current_dir(dir.path()).output().unwrap();
    std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
    Command::new("git").args(["add", "."]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();

    std::fs::write(dir.path().join("a.txt"), "modified").unwrap();
    let created = git::create_checkpoint(dir.path()).await;
    assert!(created);

    let restored = git::restore_checkpoint(dir.path()).await;
    assert!(restored);
    let content = std::fs::read_to_string(dir.path().join("a.txt")).unwrap();
    assert_eq!(content, "modified");
}

#[tokio::test]
async fn test_create_checkpoint_clean_tree() {
    let dir = TempDir::new().unwrap();
    Command::new("git").args(["init"]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.email", "test@test.com"]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["config", "user.name", "test"]).current_dir(dir.path()).output().unwrap();
    std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
    Command::new("git").args(["add", "."]).current_dir(dir.path()).output().unwrap();
    Command::new("git").args(["commit", "-m", "init"]).current_dir(dir.path()).output().unwrap();

    let created = git::create_checkpoint(dir.path()).await;
    assert!(!created);
}
