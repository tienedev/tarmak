use anyhow::Result;
use cortx_types::{
    ActionOrgan, Budget, Command, ExecutionRecord, ExecutionResult, Memory, MemoryOrgan,
    RecallQuery, Status, Tier,
};
use std::sync::Mutex;
use uuid::Uuid;

struct ServedHint {
    chain_id: String,
    #[allow(dead_code)]
    target_files: Vec<String>,
    served_at_command: u32,
}

pub struct Orchestrator {
    kanwise: kanwise::Kanwise,
    proxy: rtk_proxy::Proxy,
    memory: context_db::ContextDb,
    session_id: String,
    served_hints: Mutex<Vec<ServedHint>>,
    command_counter: Mutex<u32>,
}

impl Orchestrator {
    pub fn new(
        kanwise: kanwise::Kanwise,
        proxy: rtk_proxy::Proxy,
        memory: context_db::ContextDb,
    ) -> Self {
        Self {
            kanwise,
            proxy,
            memory,
            session_id: Uuid::new_v4().to_string(),
            served_hints: Mutex::new(Vec::new()),
            command_counter: Mutex::new(0),
        }
    }

    /// Convenience constructor for tests — creates a stub kanwise with in-memory DB
    pub async fn without_kanwise(
        proxy: rtk_proxy::Proxy,
        memory: context_db::ContextDb,
    ) -> anyhow::Result<Self> {
        let db = kanwise::Db::in_memory().await?;
        let kanwise = kanwise::Kanwise::new(db);
        Ok(Self {
            kanwise,
            proxy,
            memory,
            session_id: Uuid::new_v4().to_string(),
            served_hints: Mutex::new(Vec::new()),
            command_counter: Mutex::new(0),
        })
    }

    pub fn kanwise(&self) -> &kanwise::Kanwise {
        &self.kanwise
    }
    pub fn memory(&self) -> &context_db::ContextDb {
        &self.memory
    }
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
    pub fn remaining_budget(&self) -> Budget {
        self.proxy.remaining_budget()
    }

    /// Run memory compaction (best-effort). Call once after construction.
    pub async fn run_compaction(&self) {
        let _ = self.memory.run_compaction().await;
    }

    pub async fn execute_and_remember(&self, cmd: Command) -> Result<ExecutionResult> {
        let task_id = cmd.task_id.clone();
        let cmd_str = cmd.cmd.clone();

        // --- PRE-FLIGHT ---
        let tier = self.proxy.classify(&cmd.cmd);
        let mut preflight_hints = Vec::new();

        if tier != Tier::Safe {
            if let Ok(hints) = self.memory.recall_for_preflight(&cmd.cmd, &[]).await {
                preflight_hints = hints;
            }
        }

        // Track served hints for correlation
        let current_command = {
            let mut counter = self.command_counter.lock().unwrap();
            let c = *counter;
            *counter += 1;
            c
        };
        {
            let mut served = self.served_hints.lock().unwrap();
            for hint in &preflight_hints {
                if let Some(chain_id) = &hint.chain_id {
                    served.push(ServedHint {
                        chain_id: chain_id.clone(),
                        target_files: vec![],
                        served_at_command: current_command,
                    });
                }
            }
        }

        // --- EXECUTE ---
        let mut result = self.proxy.execute(cmd).await?;

        // Inject pre-flight hints
        if !preflight_hints.is_empty() {
            result.hints = preflight_hints;
        }

        // --- POST-FLIGHT: store execution ---
        let record = ExecutionRecord {
            session_id: self.session_id.clone(),
            task_id,
            command: result.command.clone(),
            exit_code: result.exit_code,
            tier: result.tier,
            duration_ms: result.duration_ms,
            summary: result.summary.clone(),
            errors: result.errors.clone(),
            files_touched: result.files_touched.clone(),
        };
        let _ = self.memory.store(Memory::Execution(record)).await;

        // --- POST-FLIGHT: confidence correlation ---
        let window_start = current_command.saturating_sub(5);
        let correlated_chain_ids: Vec<String> = {
            let served = self.served_hints.lock().unwrap();
            served
                .iter()
                .filter(|h| h.served_at_command >= window_start)
                .map(|h| h.chain_id.clone())
                .collect()
        };

        if result.status == Status::Passed && !correlated_chain_ids.is_empty() {
            for chain_id in &correlated_chain_ids {
                let _ = self.memory.reinforce_confidence(chain_id, 0.15).await;
            }
        } else if result.status == Status::Failed && !correlated_chain_ids.is_empty() {
            for chain_id in &correlated_chain_ids {
                let _ = self.memory.reinforce_confidence(chain_id, -0.20).await;
            }
        }

        // --- POST-FLIGHT: on failure, recall and EXTEND hints ---
        if result.status == Status::Failed {
            if let Ok(hints) = self
                .memory
                .recall(RecallQuery {
                    files: result.error_files(),
                    error_patterns: result.error_messages(),
                    ..Default::default()
                })
                .await
                && !hints.is_empty()
            {
                result.hints.extend(hints);
                return Ok(result);
            }
            return Ok(result);
        }

        // --- POST-FLIGHT: causal chain creation ---
        if result.status == Status::Passed
            && !result.files_touched.is_empty()
            && let Ok(Some(prev_fail)) = self.memory.last_failure_for_command(&cmd_str).await
            && let Some(trigger) = prev_fail.errors.first()
        {
            let _ = self
                .memory
                .store(Memory::CausalChain {
                    trigger_file: trigger.file.clone(),
                    trigger_error: Some(trigger.msg.clone()),
                    trigger_command: Some(cmd_str.clone()),
                    resolution_files: result.files_touched.clone(),
                })
                .await;
        }

        Ok(result)
    }
}
