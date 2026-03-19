//! context-db — Memory organ for cortx (SQLite + FTS5).

pub mod compact;
pub mod confidence;
pub mod db;
pub mod mcp;
pub mod migrations;
pub mod purge;
pub mod recall;
pub mod store;

pub use db::Db;

use cortx_types::{ExecutionRecord, Memory, MemoryHint, MemoryId, MemoryOrgan, RecallQuery};

pub struct ContextDb {
    db: Db,
    project_root: Option<String>,
}

impl ContextDb {
    pub async fn new(path: &str, project_root: Option<String>) -> anyhow::Result<Self> {
        let db = Db::new(path).await?;
        Ok(Self { db, project_root })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let db = Db::in_memory().await?;
        Ok(Self {
            db,
            project_root: None,
        })
    }

    pub fn db(&self) -> &Db {
        &self.db
    }

    pub fn project_root(&self) -> Option<&str> {
        self.project_root.as_deref()
    }

    pub async fn execution_count(&self) -> anyhow::Result<u64> {
        self.db
            .with_conn(|conn| {
                let count: u64 =
                    conn.query_row("SELECT COUNT(*) FROM executions", [], |row| row.get(0))?;
                Ok(count)
            })
            .await
    }

    pub async fn reinforce_confidence(&self, chain_id: &str, delta: f64) -> anyhow::Result<()> {
        confidence::reinforce_confidence(&self.db, chain_id, delta).await
    }

    pub async fn run_compaction(&self) -> anyhow::Result<compact::CompactionStats> {
        compact::run_compaction(&self.db).await
    }

    pub async fn recall_for_preflight(
        &self,
        command: &str,
        files: &[&str],
    ) -> anyhow::Result<Vec<MemoryHint>> {
        recall::recall_for_preflight(&self.db, command, files, self.project_root.as_deref()).await
    }
}

impl MemoryOrgan for ContextDb {
    async fn store(&self, memory: Memory) -> anyhow::Result<MemoryId> {
        store::store_memory(&self.db, memory).await
    }

    async fn recall(&self, query: RecallQuery) -> anyhow::Result<Vec<MemoryHint>> {
        recall::recall(&self.db, query, self.project_root.as_deref()).await
    }

    async fn last_failure_for_command(
        &self,
        command: &str,
    ) -> anyhow::Result<Option<ExecutionRecord>> {
        recall::last_failure_for_command(&self.db, command).await
    }
}
