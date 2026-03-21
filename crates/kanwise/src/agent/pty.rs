use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// A running Claude Code session with PTY attached.
pub struct PtySession {
    /// Broadcast channel for PTY output — subscribers get real-time bytes.
    pub output_tx: broadcast::Sender<Vec<u8>>,
    /// Accumulated output for the final log.
    pub output_log: Arc<Mutex<Vec<u8>>>,
    /// Child process handle for killing.
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send>>>,
    /// Join handle for the reader thread.
    _reader_handle: Option<std::thread::JoinHandle<()>>,
}

impl PtySession {
    /// Spawn `claude -p "prompt" --dangerously-skip-permissions` in the given directory.
    pub fn spawn(prompt: &str, workdir: &Path) -> Result<Self> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open PTY")?;

        let mut cmd = CommandBuilder::new("claude");
        cmd.arg("-p");
        cmd.arg(prompt);
        cmd.arg("--dangerously-skip-permissions");
        cmd.cwd(workdir);

        let child = pair.slave.spawn_command(cmd).context("failed to spawn claude")?;
        drop(pair.slave); // Close slave side

        let (output_tx, _) = broadcast::channel::<Vec<u8>>(1024);
        let output_log = Arc::new(Mutex::new(Vec::new()));

        // Reader thread: reads PTY master and broadcasts output
        let mut reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let tx = output_tx.clone();
        let log = Arc::clone(&output_log);
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        if let Ok(mut log) = log.lock() {
                            log.extend_from_slice(&data);
                        }
                        let _ = tx.send(data);
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            output_tx,
            output_log,
            child: Arc::new(Mutex::new(child)),
            _reader_handle: Some(reader_handle),
        })
    }

    /// Wait for the child process to exit. Returns exit code.
    pub async fn wait(&self) -> Result<i32> {
        let child = Arc::clone(&self.child);
        tokio::task::spawn_blocking(move || {
            let mut child = child
                .lock()
                .map_err(|e| anyhow::anyhow!("lock error: {e}"))?;
            let status = child.wait().context("failed to wait for claude process")?;
            Ok(status.exit_code().try_into().unwrap_or(1))
        })
        .await?
    }

    /// Kill the child process.
    pub fn kill(&self) -> Result<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|e| anyhow::anyhow!("lock error: {e}"))?;
        child.kill().context("failed to kill claude process")?;
        Ok(())
    }

    /// Get the accumulated output as a string.
    pub fn get_log(&self) -> String {
        let log = self.output_log.lock().unwrap_or_else(|e| e.into_inner());
        String::from_utf8_lossy(&log).to_string()
    }
}
