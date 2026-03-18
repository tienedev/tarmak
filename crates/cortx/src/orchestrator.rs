use anyhow::Result;
use cortx_types::{
    ActionOrgan, Budget, Command, ExecutionRecord, ExecutionResult, Memory, MemoryOrgan,
    RecallQuery, Status,
};
use uuid::Uuid;

pub struct Orchestrator {
    kanwise: kanwise::Kanwise,
    proxy: rtk_proxy::Proxy,
    memory: context_db::ContextDb,
    session_id: String,
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

    pub async fn execute_and_remember(&self, cmd: Command) -> Result<ExecutionResult> {
        let task_id = cmd.task_id.clone();
        let cmd_str = cmd.cmd.clone();

        // 1. Proxy executes
        let result = self.proxy.execute(cmd).await?;

        // 2. Store execution — best-effort, never blocks
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

        // 3. On failure → check if memory knows this pattern
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
                return Ok(result.with_hints(hints));
            }
            return Ok(result);
        }

        // 4. On success after previous failure of SAME COMMAND → build causal chain
        if result.status == Status::Passed
            && let Ok(Some(prev_fail)) = self.memory.last_failure_for_command(&cmd_str).await
            && let Some(trigger) = prev_fail.errors.first()
        {
            let _ = self
                .memory
                .store(Memory::CausalChain {
                    trigger_file: trigger.file.clone(),
                    trigger_error: Some(trigger.msg.clone()),
                    resolution_files: result.files_touched.clone(),
                })
                .await;
        }

        Ok(result)
    }
}
