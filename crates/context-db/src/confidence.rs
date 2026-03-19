use anyhow::Result;
use std::process::Command;

use crate::db::Db;

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

/// Reinforce (or penalize) a causal chain's confidence.
/// Positive delta = hint was useful. Negative delta = hint was wrong.
/// Confidence is clamped to [0.0, 1.0].
pub async fn reinforce_confidence(db: &Db, chain_id: &str, delta: f64) -> Result<()> {
    let id = chain_id.to_string();
    db.with_conn(move |conn| {
        conn.execute(
            "UPDATE causal_chains SET confidence = MIN(1.0, MAX(0.0, confidence + ?1)) WHERE id = ?2",
            rusqlite::params![delta, id],
        )?;
        Ok(())
    })
    .await
}
