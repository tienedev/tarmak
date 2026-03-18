use anyhow::Result;
use std::path::PathBuf;
use std::time::Instant;
use tokio::process::Command as TokioCommand;

pub struct Executor {
    timeout_secs: u64,
}

pub struct RawResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub timed_out: bool,
}

impl Executor {
    pub fn new(timeout_secs: u64) -> Self {
        Self { timeout_secs }
    }

    pub async fn run(
        &self,
        cmd: &str,
        cwd: &PathBuf,
        env: &[(String, String)],
    ) -> Result<RawResult> {
        let start = Instant::now();
        let mut command = TokioCommand::new("sh");
        command.arg("-c").arg(cmd);
        command.current_dir(cwd);
        command.env_clear();
        for (key, value) in env {
            command.env(key, value);
        }
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let child = command.spawn()?;
        let timeout = std::time::Duration::from_secs(self.timeout_secs);

        match tokio::time::timeout(timeout, child.wait_with_output()).await {
            Ok(Ok(output)) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(RawResult {
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: output.status.code(),
                    duration_ms,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(e.into()),
            Err(_) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(RawResult {
                    stdout: String::new(),
                    stderr: format!("Command timed out after {}s", self.timeout_secs),
                    exit_code: None,
                    duration_ms,
                    timed_out: true,
                })
            }
        }
    }
}
