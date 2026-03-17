use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use futures::SinkExt;
use serde::Deserialize;
use tokio::sync::{broadcast, RwLock};
use yrs::{Transact, Update};
use yrs::updates::decoder::Decode;

use super::doc::BoardDocManager;
use crate::db::Db;

/// Minimum interval between CRDT state persistence writes per board.
const PERSIST_DEBOUNCE: Duration = Duration::from_secs(1);

/// Shared state for the sync subsystem.
///
/// Holds the CRDT document manager and per-board broadcast channels that
/// relay Y.Doc update blobs to all connected WebSocket clients.
pub struct SyncState {
    pub doc_manager: BoardDocManager,
    pub db: Db,
    channels: RwLock<HashMap<String, broadcast::Sender<Vec<u8>>>>,
    last_persist: RwLock<HashMap<String, Instant>>,
}

impl SyncState {
    pub fn new(db: Db) -> Self {
        Self {
            doc_manager: BoardDocManager::new(),
            db,
            channels: RwLock::new(HashMap::new()),
            last_persist: RwLock::new(HashMap::new()),
        }
    }

    /// Check if enough time has elapsed since the last persist for this board.
    async fn should_persist(&self, board_id: &str) -> bool {
        let last = self.last_persist.read().await;
        !matches!(last.get(board_id), Some(t) if t.elapsed() < PERSIST_DEBOUNCE)
    }

    /// Record that we just persisted state for this board.
    async fn mark_persisted(&self, board_id: &str) {
        self.last_persist.write().await.insert(board_id.to_string(), Instant::now());
    }

    /// Get (or create) the broadcast channel for a given board.
    pub async fn get_channel(&self, board_id: &str) -> broadcast::Sender<Vec<u8>> {
        {
            let chans = self.channels.read().await;
            if let Some(tx) = chans.get(board_id) {
                return tx.clone();
            }
        }
        let mut chans = self.channels.write().await;
        if let Some(tx) = chans.get(board_id) {
            return tx.clone();
        }
        let (tx, _) = broadcast::channel(256);
        chans.insert(board_id.to_string(), tx.clone());
        tx
    }

    /// Broadcast a CRDT update blob to all WebSocket clients watching this board.
    /// This is intended to be called from the REST API / MCP mutation paths so
    /// that changes made through HTTP are pushed to connected WebSocket clients.
    #[allow(dead_code)]
    pub async fn broadcast(&self, board_id: &str, update: Vec<u8>) {
        let tx = self.get_channel(board_id).await;
        // Ignore send errors (no receivers is fine).
        let _ = tx.send(update);
    }

    /// Remove broadcast channel and persist timestamp if no receivers remain.
    pub async fn cleanup_channel(&self, board_id: &str) {
        let mut chans = self.channels.write().await;
        if let Some(tx) = chans.get(board_id)
            && tx.receiver_count() == 0
        {
            chans.remove(board_id);
            self.last_persist.write().await.remove(board_id);
        }
    }
}

#[derive(Deserialize)]
pub struct WsQuery {
    token: Option<String>,
}

/// Axum handler: upgrade an HTTP request to a WebSocket connection scoped to a board.
/// Requires a valid auth token in the `token` query parameter.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(board_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<SyncState>>,
) -> impl IntoResponse {
    let token = match query.token {
        Some(t) => t,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let user = if token.starts_with("ok_") {
        let key_hash = crate::auth::hash_token(&token);
        state.db.validate_api_key(&key_hash).await
    } else {
        crate::auth::validate_session(&state.db, &token).await
    };

    match user {
        Ok(u) => {
            // Verify the user is a member of this board.
            match state.db.get_board_member(&board_id, &u.id).await {
                Ok(Some(_)) => ws.on_upgrade(move |socket| handle_socket(socket, board_id, state)).into_response(),
                _ => StatusCode::FORBIDDEN.into_response(),
            }
        }
        Err(_) => StatusCode::UNAUTHORIZED.into_response(),
    }
}

/// Core WebSocket loop for one client on one board.
async fn handle_socket(socket: WebSocket, board_id: String, state: Arc<SyncState>) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // 1. Initialise the Y.Doc from database state (idempotent).
    let doc = match state.doc_manager.init_from_db(&board_id, &state.db).await {
        Ok(d) => d,
        Err(e) => {
            tracing::error!("Failed to init doc for board {board_id}: {e}");
            return;
        }
    };

    // 2. Send full initial state to the client.
    let initial_state = BoardDocManager::encode_full_state(&doc);
    if ws_tx
        .send(Message::Binary(initial_state.into()))
        .await
        .is_err()
    {
        return; // client already disconnected
    }

    // 3. Subscribe to broadcast channel so we relay updates from other clients / REST API.
    let tx = state.get_channel(&board_id).await;
    let mut rx = tx.subscribe();

    // 4. Spawn a task that forwards broadcast messages to this client's WebSocket sender.
    let send_task = tokio::spawn(async move {
        while let Ok(data) = rx.recv().await {
            if ws_tx
                .send(Message::Binary(data.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // 5. Receive updates from the client and integrate them into the Y.Doc.
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Binary(data) => {
                // Decode and apply the CRDT update (all !Send yrs types scoped here).
                let applied = match Update::decode_v1(&data) {
                    Ok(update) => {
                        let mut txn = doc.transact_mut();
                        if let Err(e) = txn.apply_update(update) {
                            tracing::warn!("Bad CRDT update from client: {e}");
                        }
                        true
                    }
                    Err(e) => {
                        tracing::warn!("Failed to decode CRDT update: {e}");
                        false
                    }
                };

                if applied {
                    // Debounced persistence: at most once per PERSIST_DEBOUNCE interval
                    if state.should_persist(&board_id).await {
                        let state_bytes = BoardDocManager::encode_full_state(&doc);
                        if let Err(e) = state.db.save_crdt_state(&board_id, &state_bytes).await {
                            tracing::warn!("Failed to persist CRDT state for board {board_id}: {e}");
                        }
                        state.mark_persisted(&board_id).await;
                    }

                    // Relay to other connected clients.
                    let _ = tx.send(data.to_vec());
                }
            }
            Message::Close(_) => break,
            _ => {} // ignore text/ping/pong
        }
    }

    // Final persist on disconnect to ensure no updates are lost
    let state_bytes = BoardDocManager::encode_full_state(&doc);
    if let Err(e) = state.db.save_crdt_state(&board_id, &state_bytes).await {
        tracing::warn!("Failed to persist final CRDT state for board {board_id}: {e}");
    }

    // Clean up: abort the sender task and remove empty channels.
    send_task.abort();
    state.cleanup_channel(&board_id).await;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// SyncState can create broadcast channels on demand.
    #[tokio::test]
    async fn broadcast_channel_creation() {
        let db = Db::in_memory().await.expect("in-memory db");
        let state = SyncState::new(db);
        let tx1 = state.get_channel("b1").await;
        let tx2 = state.get_channel("b1").await;
        // Same channel, so receiver_count matches.
        assert_eq!(tx1.receiver_count(), tx2.receiver_count());
    }

    /// Broadcasting when nobody is listening should not panic.
    #[tokio::test]
    async fn broadcast_no_receivers() {
        let db = Db::in_memory().await.expect("in-memory db");
        let state = SyncState::new(db);
        state.broadcast("phantom", vec![1, 2, 3]).await;
        // No panic = success.
    }
}
