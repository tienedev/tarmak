use std::process::Command;

pub const DEFAULT_CHURN_NORMALIZER: u32 = 15;

pub fn compute_confidence(base: f64, commits_since_verified: u32, normalizer: u32) -> f64 {
    if normalizer == 0 {
        return 0.0;
    }
    let churn_rate = (commits_since_verified as f64 / normalizer as f64).min(1.0);
    base * (1.0 - churn_rate)
}

pub fn count_commits_since(file: &str, since: &str, cwd: &str) -> u32 {
    let output = Command::new("git")
        .args([
            "log",
            "--oneline",
            &format!("--since={since}"),
            "--",
            file,
        ])
        .current_dir(cwd)
        .output();
    match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).lines().count() as u32,
        Err(_) => 0,
    }
}
