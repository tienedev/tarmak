use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tokio::sync::broadcast;

/// A Claude Code session that runs in `-p` (print) mode with output captured
/// to a log file, displayed in a real terminal window.
pub struct PtySession {
    /// Broadcast channel kept for WebSocket compatibility.
    pub output_tx: broadcast::Sender<Vec<u8>>,
    /// Session ID for temp file naming.
    session_id: String,
    /// Temp directory for session files.
    tmp_dir: PathBuf,
}

impl PtySession {
    /// Spawn `claude -p` in a real terminal window with output captured to a log file.
    pub fn spawn(prompt: &str, workdir: &Path, session_id: &str) -> Result<Self> {
        let claude_bin = which::which("claude")
            .context("claude not found in PATH — is Claude Code installed?")?;

        let tmp_dir = std::env::temp_dir().join("kanwise-sessions");
        std::fs::create_dir_all(&tmp_dir)?;

        let prompt_file = tmp_dir.join(format!("{session_id}.prompt"));
        let script_file = tmp_dir.join(format!("{session_id}.sh"));
        let pid_file = tmp_dir.join(format!("{session_id}.pid"));
        let exit_file = tmp_dir.join(format!("{session_id}.exit"));
        let log_file = tmp_dir.join(format!("{session_id}.log"));

        for f in [&prompt_file, &script_file, &pid_file, &exit_file, &log_file] {
            let _ = std::fs::remove_file(f);
        }

        std::fs::write(&prompt_file, prompt)?;

        // -p mode: runs and exits automatically when done.
        // --verbose: shows tool calls, thinking, file edits.
        // tee: captures output to log file while still showing in terminal.
        let script = format!(
            r#"#!/bin/bash
unset CLAUDECODE
EXIT_FILE="{exit}"
LOG_FILE="{log}"
trap 'echo 130 > "$EXIT_FILE"; exit 130' HUP INT TERM
echo $$ > "{pid}"
cd "{workdir}"
PROMPT=$(cat "{prompt}")
"{claude}" -p "$PROMPT" --dangerously-skip-permissions --verbose 2>&1 | tee "$LOG_FILE"
EXIT_CODE=${{PIPESTATUS[0]}}
echo $EXIT_CODE > "$EXIT_FILE"
echo ""
echo "--- Session finished (exit code: $EXIT_CODE) ---"
echo "This terminal window can be closed."
"#,
            pid = pid_file.display(),
            workdir = workdir.display(),
            prompt = prompt_file.display(),
            claude = claude_bin.display(),
            exit = exit_file.display(),
            log = log_file.display(),
        );
        std::fs::write(&script_file, &script)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_file, std::fs::Permissions::from_mode(0o755))?;
        }

        open_terminal(&script_file)?;

        let (output_tx, _) = broadcast::channel::<Vec<u8>>(16);

        Ok(Self {
            output_tx,
            session_id: session_id.to_string(),
            tmp_dir,
        })
    }

    /// Wait for the child process to exit by polling the exit code file.
    pub async fn wait(&self) -> Result<i32> {
        let exit_file = self.tmp_dir.join(format!("{}.exit", self.session_id));
        let pid_file = self.tmp_dir.join(format!("{}.pid", self.session_id));
        loop {
            if exit_file.exists() {
                let content = tokio::fs::read_to_string(&exit_file).await?;
                let code = content.trim().parse::<i32>().unwrap_or(1);
                return Ok(code);
            }
            // Fallback: detect dead process even if trap didn't fire
            if pid_file.exists()
                && let Ok(content) = tokio::fs::read_to_string(&pid_file).await
                && let Ok(pid) = content.trim().parse::<u32>()
            {
                let alive = std::process::Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                if !alive {
                    return Ok(1);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    /// Kill the child process via its PID.
    pub fn kill(&self) -> Result<()> {
        let pid_file = self.tmp_dir.join(format!("{}.pid", self.session_id));
        if pid_file.exists() {
            let content = std::fs::read_to_string(&pid_file)?;
            if let Ok(pid) = content.trim().parse::<u32>() {
                std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output()
                    .ok();
            }
        }
        Ok(())
    }

    /// Get the captured log output.
    pub fn get_log(&self) -> String {
        let log_file = self.tmp_dir.join(format!("{}.log", self.session_id));
        std::fs::read_to_string(&log_file).unwrap_or_default()
    }

    /// Clean up temporary files for this session.
    pub fn cleanup(&self) {
        for ext in ["prompt", "sh", "pid", "exit", "log"] {
            let f = self.tmp_dir.join(format!("{}.{ext}", self.session_id));
            let _ = std::fs::remove_file(f);
        }
    }
}

/// Open a script in a new terminal window, platform-specific.
fn open_terminal(script: &Path) -> Result<()> {
    let script_path = script.display().to_string();

    if cfg!(target_os = "macos") {
        open_terminal_macos(&script_path)
    } else if cfg!(target_os = "linux") {
        open_terminal_linux(&script_path)
    } else {
        anyhow::bail!("Unsupported OS — only macOS and Linux are supported")
    }
}

fn open_terminal_macos(script_path: &str) -> Result<()> {
    let osascript = format!(
        r#"tell application "Terminal"
    do script "{script_path}"
    activate
end tell"#
    );
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&osascript)
        .output()
        .context("failed to open Terminal.app via osascript")?;
    Ok(())
}

fn open_terminal_linux(script_path: &str) -> Result<()> {
    let terminals: &[(&str, &[&str])] = &[
        ("kitty", &["--", "bash", script_path]),
        ("alacritty", &["-e", "bash", script_path]),
        ("foot", &["bash", script_path]),
        ("wezterm", &["start", "--", "bash", script_path]),
        ("gnome-terminal", &["--", "bash", script_path]),
        ("konsole", &["-e", "bash", script_path]),
        ("xfce4-terminal", &["-e", &format!("bash {script_path}")]),
        ("xterm", &["-e", "bash", script_path]),
    ];

    for (bin, args) in terminals {
        if which::which(bin).is_ok() {
            std::process::Command::new(bin)
                .args(*args)
                .spawn()
                .with_context(|| format!("failed to open {bin}"))?;
            return Ok(());
        }
    }

    anyhow::bail!(
        "No terminal emulator found. Install one of: kitty, alacritty, foot, wezterm, gnome-terminal, konsole, xfce4-terminal, xterm"
    )
}
