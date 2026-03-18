//! context-db — Memory organ for cortx (SQLite + FTS5).

pub mod db;
pub mod decay;
pub mod mcp;
pub mod migrations;
pub mod purge;
pub mod recall;
pub mod store;

pub use db::Db;

use cortx_types::{ExecutionRecord, Memory, MemoryHint, MemoryId, MemoryOrgan, RecallQuery};

pub struct ContextDb {
    db: Db,
}

impl ContextDb {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let db = Db::new(path).await?;
        Ok(Self { db })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let db = Db::in_memory().await?;
        Ok(Self { db })
    }

    pub fn db(&self) -> &Db {
        &self.db
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
}

impl MemoryOrgan for ContextDb {
    async fn store(&self, memory: Memory) -> anyhow::Result<MemoryId> {
        store::store_memory(&self.db, memory).await
    }

    async fn recall(&self, query: RecallQuery) -> anyhow::Result<Vec<MemoryHint>> {
        recall::recall(&self.db, query).await
    }

    async fn last_failure_for_command(
        &self,
        command: &str,
    ) -> anyhow::Result<Option<ExecutionRecord>> {
        recall::last_failure_for_command(&self.db, command).await
    }
}
