use rusqlite::Connection;

#[derive(Clone)]
pub struct Db {
    conn: tokio_rusqlite::Connection,
}

impl Db {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open(path).await?;
        conn.call(|conn| -> anyhow::Result<()> {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            crate::migrations::run_migrations(conn)?;
            Ok(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("context-db init: {e}"))?;
        Ok(Self { conn })
    }

    pub async fn in_memory() -> anyhow::Result<Self> {
        let conn = tokio_rusqlite::Connection::open_in_memory().await?;
        conn.call(|conn| -> anyhow::Result<()> {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            crate::migrations::run_migrations(conn)?;
            Ok(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("context-db init: {e}"))?;
        Ok(Self { conn })
    }

    pub async fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut Connection) -> anyhow::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        self.conn
            .call(f)
            .await
            .map_err(|e| anyhow::anyhow!("context-db: {e}"))
    }
}
