use anyhow::Result;
use cortx_types::{ActionOrgan, Budget, Command, ExecutionMode, ExecutionResult, Status, Tier};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::budget::BudgetTracker;
use crate::execute::Executor;
use crate::output::{self, OutputProcessor};
use crate::policy::Policy;
use crate::sandbox::Sandbox;

pub struct Proxy {
    policy: Policy,
    sandbox: Sandbox,
    budget: Mutex<BudgetTracker>,
    output_processor: OutputProcessor,
}

impl Proxy {
    pub fn from_toml(toml_str: &str, project_root: PathBuf) -> Result<Self> {
        let policy = Policy::from_toml(toml_str)?;
        let sandbox = Sandbox::new(&policy.sandbox, project_root);
        let budget = Mutex::new(BudgetTracker::new(&policy.budget, &policy.circuit_breaker));
        let output_processor = OutputProcessor::new(&policy.output);
        Ok(Self {
            policy,
            sandbox,
            budget,
            output_processor,
        })
    }

    pub fn from_file(path: &str, project_root: PathBuf) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        Self::from_toml(&content, project_root)
    }

    pub fn remaining_budget(&self) -> Budget {
        self.budget.lock().unwrap().remaining()
    }

    fn make_result(
        &self,
        status: Status,
        cmd: &str,
        tier: Tier,
        summary: String,
    ) -> ExecutionResult {
        ExecutionResult {
            status,
            exit_code: None,
            duration_ms: 0,
            command: cmd.to_string(),
            tier,
            summary,
            errors: Vec::new(),
            warnings: Vec::new(),
            truncated: false,
            budget_remaining: self.remaining_budget(),
            hints: Vec::new(),
            files_touched: Vec::new(),
        }
    }
}

impl ActionOrgan for Proxy {
    async fn execute(&self, cmd: Command) -> Result<ExecutionResult> {
        let tier = self.policy.classify(&cmd.cmd);

        // Admin bypasses layers 1-4
        if cmd.mode == ExecutionMode::Admin {
            let executor = Executor::new(self.sandbox.timeout_secs());
            let env: Vec<(String, String)> = std::env::vars().collect();
            let before_snapshot = crate::git::status_snapshot(&cmd.cwd);
            let raw = executor.run(&cmd.cmd, &cmd.cwd, &env).await?;
            let after_snapshot = crate::git::status_snapshot(&cmd.cwd);
            let files_touched = crate::git::diff_snapshots(&before_snapshot, &after_snapshot);
            let (output, truncated) = self
                .output_processor
                .process(&format!("{}\n{}", raw.stdout, raw.stderr));
            let status = if raw.timed_out {
                Status::Timeout
            } else if raw.exit_code == Some(0) {
                Status::Passed
            } else {
                Status::Failed
            };
            return Ok(ExecutionResult {
                status,
                exit_code: raw.exit_code,
                duration_ms: raw.duration_ms,
                command: cmd.cmd,
                tier,
                summary: output,
                errors: Vec::new(),
                warnings: Vec::new(),
                truncated,
                budget_remaining: self.remaining_budget(),
                hints: Vec::new(),
                files_touched,
            });
        }

        // Tier check
        match tier {
            Tier::Forbidden => {
                return Ok(self.make_result(
                    Status::Forbidden,
                    &cmd.cmd,
                    tier,
                    format!("Command forbidden by policy: {}", cmd.cmd),
                ));
            }
            Tier::Dangerous if cmd.mode == ExecutionMode::Autonomous => {
                return Ok(self.make_result(
                    Status::Blocked,
                    &cmd.cmd,
                    tier,
                    format!("Dangerous command blocked in autonomous mode: {}", cmd.cmd),
                ));
            }
            _ => {}
        }

        // Budget check
        {
            let mut budget = self.budget.lock().unwrap();
            if let Err(e) = budget.check_and_record(&cmd.cmd, 0) {
                return Ok(self.make_result(
                    Status::Blocked,
                    &cmd.cmd,
                    tier,
                    format!("Budget/rate limit: {e}"),
                ));
            }
        }

        // Sandbox
        if let Err(e) = self.sandbox.validate_cwd(&cmd.cwd) {
            return Ok(self.make_result(
                Status::Blocked,
                &cmd.cmd,
                tier,
                format!("Sandbox violation: {e}"),
            ));
        }
        let env_full: Vec<(String, String)> = std::env::vars().collect();
        let env_filtered = self.sandbox.filter_env(&env_full);

        // Checkpoint before monitored/dangerous commands
        let _checkpoint_created = match tier {
            Tier::Monitored if self.policy.checkpoint.before_monitored => {
                crate::git::create_checkpoint(&cmd.cwd)
            }
            Tier::Dangerous if self.policy.checkpoint.before_dangerous => {
                crate::git::create_checkpoint(&cmd.cwd)
            }
            _ => false,
        };

        // Execute
        let before_snapshot = crate::git::status_snapshot(&cmd.cwd);
        let executor = Executor::new(self.sandbox.timeout_secs());
        let raw = executor.run(&cmd.cmd, &cmd.cwd, &env_filtered).await?;
        let after_snapshot = crate::git::status_snapshot(&cmd.cwd);
        let files_touched = crate::git::diff_snapshots(&before_snapshot, &after_snapshot);

        // Output processing
        let combined = format!("{}\n{}", raw.stdout, raw.stderr);
        let (processed_output, truncated) = self.output_processor.process(&combined);
        let parsed = if cmd.cmd.starts_with("cargo test") {
            Some(output::parse_cargo_test(&combined))
        } else {
            None
        };
        let status = if raw.timed_out {
            Status::Timeout
        } else if raw.exit_code == Some(0) {
            Status::Passed
        } else {
            Status::Failed
        };

        // Circuit breaker
        {
            let mut budget = self.budget.lock().unwrap();
            if status == Status::Passed {
                budget.record_success();
            } else if status == Status::Failed {
                budget.record_failure();
            }
        }

        let (summary, errors, warnings) = if let Some(p) = parsed {
            (
                if p.summary.is_empty() {
                    processed_output.clone()
                } else {
                    p.summary
                },
                p.errors,
                p.warnings,
            )
        } else {
            (processed_output, Vec::new(), Vec::new())
        };

        let cpu_secs = (raw.duration_ms / 1000) as u32;
        if cpu_secs > 0 {
            self.budget.lock().unwrap().record_cpu(cpu_secs);
        }

        Ok(ExecutionResult {
            status,
            exit_code: raw.exit_code,
            duration_ms: raw.duration_ms,
            command: cmd.cmd,
            tier,
            summary,
            errors,
            warnings,
            truncated,
            budget_remaining: self.remaining_budget(),
            hints: Vec::new(),
            files_touched,
        })
    }
}
