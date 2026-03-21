pub mod clean;
pub mod config;
pub mod detect;
pub mod doctor;
pub mod hook;
pub mod install;
pub mod update;

use std::path::PathBuf;

/// Detect a binary in PATH using `which`. Returns its path if found.
pub fn detect_binary(name: &str) -> Option<PathBuf> {
    std::process::Command::new("which")
        .arg(name)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim().to_string()))
}
