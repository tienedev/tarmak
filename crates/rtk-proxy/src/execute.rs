use anyhow::Result;
use std::path::PathBuf;
use std::time::Instant;
use tokio::io::AsyncReadExt;
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

        let mut child = command.spawn()?;
        let timeout = std::time::Duration::from_secs(self.timeout_secs);

        // Take stdout/stderr handles before waiting so we retain ownership of `child`
        // for killing on timeout.
        let mut stdout_handle = child.stdout.take().expect("stdout was piped");
        let mut stderr_handle = child.stderr.take().expect("stderr was piped");

        let wait_fut = async {
            let mut stdout_buf = Vec::new();
            let mut stderr_buf = Vec::new();
            let (stdout_res, stderr_res, wait_res) = tokio::join!(
                stdout_handle.read_to_end(&mut stdout_buf),
                stderr_handle.read_to_end(&mut stderr_buf),
                child.wait(),
            );
            stdout_res?;
            stderr_res?;
            let status = wait_res?;
            Ok::<_, std::io::Error>((stdout_buf, stderr_buf, status))
        };

        match tokio::time::timeout(timeout, wait_fut).await {
            Ok(Ok((stdout_buf, stderr_buf, status))) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(RawResult {
                    stdout: String::from_utf8_lossy(&stdout_buf).to_string(),
                    stderr: String::from_utf8_lossy(&stderr_buf).to_string(),
                    exit_code: status.code(),
                    duration_ms,
                    timed_out: false,
                })
            }
            Ok(Err(e)) => Err(e.into()),
            Err(_) => {
                // Timeout fired — kill the child process and reap it to avoid zombies.
                let _ = child.kill().await;
                let _ = child.wait().await;
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
