use regex::Regex;
use std::sync::LazyLock;
use tokio::sync::broadcast;

use crate::db::models::Notification;

/// Broadcast channel wrapper for notification delivery.
/// Added as an Axum `Extension` so handlers can extract it.
#[derive(Clone)]
pub struct NotifTx(pub broadcast::Sender<(String, Notification)>);

/// Send a notification on the broadcast channel (fire-and-forget).
/// Errors (no active receivers) are silently ignored.
pub fn broadcast(tx: &NotifTx, notif: &Notification) {
    let _ = tx.0.send((notif.user_id.clone(), notif.clone()));
}

// ---------------------------------------------------------------------------
// Mention parser
// ---------------------------------------------------------------------------

static MENTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<span[^>]*data-type="mention"[^>]*data-id="([^"]+)"[^>]*>"#).unwrap()
});

/// Extract mentioned user IDs from Tiptap HTML content.
pub fn parse_mentions(html: &str) -> Vec<String> {
    MENTION_RE
        .captures_iter(html)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_mentions_basic() {
        let html = r#"<p>Hello <span data-type="mention" data-id="user-1" class="mention">@Alice</span></p>"#;
        assert_eq!(parse_mentions(html), vec!["user-1"]);
    }

    #[test]
    fn test_parse_mentions_multiple() {
        let html = r#"<p><span data-type="mention" data-id="u1" class="mention">@A</span> and <span data-type="mention" data-id="u2" class="mention">@B</span></p>"#;
        assert_eq!(parse_mentions(html), vec!["u1", "u2"]);
    }

    #[test]
    fn test_parse_mentions_none() {
        assert!(parse_mentions("<p>no mentions</p>").is_empty());
    }
}
