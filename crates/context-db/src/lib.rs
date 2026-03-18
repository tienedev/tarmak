//! context-db — Memory organ for cortx (SQLite + FTS5).

pub mod db;
pub mod migrations;

pub use db::Db;

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
