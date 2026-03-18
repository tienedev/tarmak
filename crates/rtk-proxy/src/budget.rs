use anyhow::{bail, Result};
use cortx_types::Budget;
use std::collections::VecDeque;
use std::time::Instant;

use crate::policy::{BudgetConfig, CircuitBreakerConfig};

pub struct BudgetTracker {
    max_commands: u32,
    max_cpu_seconds: u32,
    loop_threshold: u32,
    loop_window_secs: u64,
    commands_used: u32,
    cpu_seconds_used: u32,
    recent_commands: VecDeque<(String, Instant)>,
    consecutive_failures: u32,
    max_consecutive_failures: u32,
    circuit_breaker_action: String,
}

impl BudgetTracker {
    pub fn new(budget: &BudgetConfig, cb: &CircuitBreakerConfig) -> Self {
        Self {
            max_commands: budget.max_commands_per_session,
            max_cpu_seconds: budget.max_cpu_seconds,
            loop_threshold: budget.loop_threshold,
            loop_window_secs: budget.loop_window_seconds,
            commands_used: 0,
            cpu_seconds_used: 0,
            recent_commands: VecDeque::new(),
            consecutive_failures: 0,
            max_consecutive_failures: cb.max_consecutive_failures,
            circuit_breaker_action: cb.action.clone(),
        }
    }

    pub fn check_and_record(&mut self, cmd: &str, cpu_seconds: u32) -> Result<()> {
        if self.is_circuit_open() {
            bail!(
                "Circuit breaker open: {} consecutive failures",
                self.consecutive_failures
            );
        }
        if self.commands_used >= self.max_commands {
            bail!(
                "Command budget exhausted: {}/{}",
                self.commands_used,
                self.max_commands
            );
        }
        if self.cpu_seconds_used + cpu_seconds > self.max_cpu_seconds {
            bail!(
                "CPU budget exhausted: {}s/{}s",
                self.cpu_seconds_used,
                self.max_cpu_seconds
            );
        }

        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.loop_window_secs);
        while self
            .recent_commands
            .front()
            .is_some_and(|(_, t)| now.duration_since(*t) > window)
        {
            self.recent_commands.pop_front();
        }
        let same_cmd_count = self
            .recent_commands
            .iter()
            .filter(|(c, _)| c == cmd)
            .count() as u32;
        if same_cmd_count >= self.loop_threshold {
            bail!(
                "Loop detected: '{}' executed {} times in {}s window",
                cmd,
                same_cmd_count,
                self.loop_window_secs
            );
        }

        self.commands_used += 1;
        self.cpu_seconds_used += cpu_seconds;
        self.recent_commands.push_back((cmd.to_string(), now));
        Ok(())
    }

    pub fn record_failure(&mut self) {
        self.consecutive_failures += 1;
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    #[allow(dead_code)]
    pub fn record_cpu(&mut self, cpu_seconds: u32) {
        self.cpu_seconds_used += cpu_seconds;
    }

    pub fn is_circuit_open(&self) -> bool {
        self.circuit_breaker_action == "suspend"
            && self.consecutive_failures >= self.max_consecutive_failures
    }

    pub fn remaining(&self) -> Budget {
        Budget {
            commands_remaining: self.max_commands.saturating_sub(self.commands_used),
            cpu_seconds_remaining: self.max_cpu_seconds.saturating_sub(self.cpu_seconds_used),
        }
    }
}
