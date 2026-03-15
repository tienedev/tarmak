use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use yrs::{Doc, Map, ReadTxn, Transact, Update, WriteTxn};
use yrs::updates::decoder::Decode;

use crate::db::Db;

/// Manages one Y.Doc per board. Each doc contains two root-level YMaps:
///   - "columns": column_id -> JSON-serialized column
///   - "tasks": task_id -> JSON-serialized task
pub struct BoardDocManager {
    docs: Arc<RwLock<HashMap<String, Arc<Doc>>>>,
}

impl BoardDocManager {
    pub fn new() -> Self {
        Self {
            docs: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Return the Y.Doc for `board_id`, creating a fresh empty one if absent.
    pub async fn get_or_create(&self, board_id: &str) -> Arc<Doc> {
        // Fast path: read lock.
        {
            let docs = self.docs.read().await;
            if let Some(doc) = docs.get(board_id) {
                return Arc::clone(doc);
            }
        }
        // Slow path: write lock + insert.
        let mut docs = self.docs.write().await;
        // Double-check after acquiring write lock.
        if let Some(doc) = docs.get(board_id) {
            return Arc::clone(doc);
        }
        let doc = Arc::new(Doc::new());
        docs.insert(board_id.to_string(), Arc::clone(&doc));
        doc
    }

    /// Populate a board's Y.Doc from current database state.
    ///
    /// If a persisted CRDT state blob exists, it is applied directly.
    /// Otherwise, columns and tasks are loaded from the relational tables.
    ///
    /// This is idempotent -- calling it on a doc that already has data will
    /// overwrite keys with the latest DB values (which is fine because
    /// the DB is the source of truth at init time).
    pub async fn init_from_db(&self, board_id: &str, db: &Db) -> anyhow::Result<Arc<Doc>> {
        let doc = self.get_or_create(board_id).await;

        // Try loading persisted CRDT state first
        if let Some(state_bytes) = db.load_crdt_state(board_id)?
            && let Ok(update) = Update::decode_v1(&state_bytes)
        {
            let mut txn = doc.transact_mut();
            let _ = txn.apply_update(update);
            drop(txn);
            return Ok(doc);
        }

        // Fall back to building from database rows
        let columns = db.list_columns(board_id)?;
        let tasks = db.list_tasks(board_id)?;

        {
            let mut txn = doc.transact_mut();
            let columns_map = txn.get_or_insert_map("columns");
            let tasks_map = txn.get_or_insert_map("tasks");

            for col in &columns {
                let json = serde_json::to_string(col)?;
                columns_map.insert(&mut txn, col.id.as_str(), json);
            }

            for task in &tasks {
                let json = serde_json::to_string(task)?;
                tasks_map.insert(&mut txn, task.id.as_str(), json);
            }
        } // txn committed on drop

        Ok(doc)
    }

    /// Encode the full document state as a V1 update blob (for sending to
    /// a newly-connected WebSocket client).
    pub fn encode_full_state(doc: &Doc) -> Vec<u8> {
        let txn = doc.transact();
        txn.encode_state_as_update_v1(&yrs::StateVector::default())
    }

    /// Remove a board's doc from memory (e.g. when no clients are connected).
    #[allow(dead_code)]
    pub async fn remove(&self, board_id: &str) {
        let mut docs = self.docs.write().await;
        docs.remove(board_id);
    }

    /// Number of docs currently held in memory (useful for tests/metrics).
    #[allow(dead_code)]
    pub async fn len(&self) -> usize {
        let docs = self.docs.read().await;
        docs.len()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn get_or_create_returns_same_doc() {
        let mgr = BoardDocManager::new();
        let d1 = mgr.get_or_create("board-1").await;
        let d2 = mgr.get_or_create("board-1").await;
        // Must be the exact same Arc (same pointer).
        assert!(Arc::ptr_eq(&d1, &d2));
    }

    #[tokio::test]
    async fn different_boards_get_different_docs() {
        let mgr = BoardDocManager::new();
        let d1 = mgr.get_or_create("board-a").await;
        let d2 = mgr.get_or_create("board-b").await;
        assert!(!Arc::ptr_eq(&d1, &d2));
    }

    #[tokio::test]
    async fn init_from_db_populates_maps() {
        use crate::db::models::Priority;

        let db = Db::in_memory().expect("in-memory db");
        let board = db.create_board("Test", None).unwrap();
        let col = db
            .create_column(&board.id, "To Do", None, None)
            .unwrap();
        let _task = db
            .create_task(&board.id, &col.id, "First", None, Priority::Medium, None)
            .unwrap();

        let mgr = BoardDocManager::new();
        let doc = mgr.init_from_db(&board.id, &db).await.unwrap();

        // Read back via yrs transaction.
        let txn = doc.transact();
        let columns_map = txn.get_map("columns").expect("columns map exists");
        let tasks_map = txn.get_map("tasks").expect("tasks map exists");

        assert_eq!(columns_map.len(&txn), 1);
        assert_eq!(tasks_map.len(&txn), 1);
    }

    #[tokio::test]
    async fn encode_full_state_roundtrip() {
        use yrs::updates::decoder::Decode;
        use yrs::Update;

        let db = Db::in_memory().expect("in-memory db");
        let board = db.create_board("Sync", None).unwrap();
        let col = db.create_column(&board.id, "Col", None, None).unwrap();
        db.create_task(
            &board.id,
            &col.id,
            "Task A",
            None,
            crate::db::models::Priority::Low,
            None,
        )
        .unwrap();

        let mgr = BoardDocManager::new();
        let doc = mgr.init_from_db(&board.id, &db).await.unwrap();

        let state = BoardDocManager::encode_full_state(&doc);
        assert!(!state.is_empty());

        // Apply to a fresh doc -- the maps should appear.
        let doc2 = Doc::new();
        {
            let mut txn2 = doc2.transact_mut();
            let update = Update::decode_v1(&state).unwrap();
            txn2.apply_update(update).unwrap();
        }

        let txn2 = doc2.transact();
        let tasks_map = txn2.get_map("tasks").expect("tasks map exists in replica");
        assert_eq!(tasks_map.len(&txn2), 1);
    }

    #[tokio::test]
    async fn remove_drops_doc() {
        let mgr = BoardDocManager::new();
        mgr.get_or_create("x").await;
        assert_eq!(mgr.len().await, 1);
        mgr.remove("x").await;
        assert_eq!(mgr.len().await, 0);
    }
}
