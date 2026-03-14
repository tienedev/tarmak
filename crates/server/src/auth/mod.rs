use anyhow::Context;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use chrono::{Duration, Utc};
use rand::Rng;
use rusqlite::params;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::Db;
use crate::db::models::User;

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/// Generate a cryptographically random 32-byte hex token.
pub fn generate_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    hex::encode(bytes)
}

/// SHA-256 hash a raw token for safe storage.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate an API key with the `ok_` prefix.
/// Returns (raw_key, key_hash, key_prefix).
pub fn generate_api_key() -> (String, String, String) {
    let bytes: [u8; 32] = rand::rng().random();
    let raw = format!("ok_{}", hex::encode(bytes));
    let hash = hash_token(&raw);
    let prefix = raw[..10].to_string();
    (raw, hash, prefix)
}

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hash error: {e}"))?;
    Ok(hash.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> anyhow::Result<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| anyhow::anyhow!("parse hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/// Create a new session for the given user. Returns the raw (unhashed) token
/// that the client should store and send as a Bearer token.
pub fn create_session(db: &Db, user_id: &str) -> anyhow::Result<String> {
    let raw_token = generate_token();
    let token_hash = hash_token(&raw_token);
    let id = Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + Duration::days(30)).to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (id, user_id, token_hash, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, user_id, token_hash, expires_at],
        )
        .context("insert session")?;
        Ok(())
    })?;

    Ok(raw_token)
}

/// Validate a raw bearer token against stored sessions. Returns the user if
/// the session is valid and not expired.
pub fn validate_session(db: &Db, token: &str) -> anyhow::Result<User> {
    let token_hash = hash_token(token);
    let now = Utc::now().to_rfc3339();

    let user = db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT u.id, u.name, u.email, u.avatar_url, u.is_agent, u.created_at
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?1 AND s.expires_at > ?2",
        )?;
        let mut rows = stmt.query_map(params![token_hash, now], |row| {
            let is_agent: i64 = row.get(4)?;
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                avatar_url: row.get(3)?,
                is_agent: is_agent != 0,
                created_at: chrono::DateTime::parse_from_rfc3339(
                    &row.get::<_, String>(5)?,
                )
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        match rows.next() {
            Some(r) => Ok(r?),
            None => Err(anyhow::anyhow!("invalid or expired session")),
        }
    })?;

    // Probabilistic cleanup: ~1-in-256 chance on each validation
    if rand::random::<u8>() == 0 {
        let _ = cleanup_expired_sessions(db);
    }

    Ok(user)
}

/// Delete all sessions whose `expires_at` has passed. Returns the number of
/// rows removed.
pub fn cleanup_expired_sessions(db: &Db) -> anyhow::Result<usize> {
    let now = Utc::now().to_rfc3339();
    db.with_conn(|conn| {
        let affected = conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            params![now],
        )?;
        Ok(affected)
    })
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

/// Create an invite link for a board. Returns the raw invite token.
pub fn create_invite_link(
    db: &Db,
    board_id: &str,
    role: &str,
    created_by: &str,
) -> anyhow::Result<String> {
    let raw_token = generate_token();
    let id = Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + Duration::days(7)).to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO invite_links (id, board_id, token, role, expires_at, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, board_id, raw_token, role, expires_at, created_by],
        )
        .context("insert invite link")?;
        Ok(())
    })?;

    Ok(raw_token)
}

/// Accept an invite link: look up the invite, verify it hasn't expired,
/// then add the user as a board member with the specified role.
pub fn accept_invite(db: &Db, invite_token: &str, user_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT board_id, role FROM invite_links
             WHERE token = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
        )?;
        let mut rows = stmt.query_map(params![invite_token, now], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let (board_id, role) = match rows.next() {
            Some(r) => r?,
            None => return Err(anyhow::anyhow!("invalid or expired invite")),
        };

        conn.execute(
            "INSERT OR IGNORE INTO board_members (board_id, user_id, role)
             VALUES (?1, ?2, ?3)",
            params![board_id, user_id, role],
        )
        .context("insert board member")?;

        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let hash = hash_password("my-secure-password").unwrap();
        assert!(verify_password("my-secure-password", &hash).unwrap());
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn test_generate_token_length_and_uniqueness() {
        let t1 = generate_token();
        let t2 = generate_token();
        // 32 bytes = 64 hex chars
        assert_eq!(t1.len(), 64);
        assert_eq!(t2.len(), 64);
        assert_ne!(t1, t2, "tokens must be unique");
    }

    #[test]
    fn test_hash_token_deterministic() {
        let token = "test-token-abc";
        let h1 = hash_token(token);
        let h2 = hash_token(token);
        assert_eq!(h1, h2, "same input must produce same hash");
        // SHA-256 produces 32 bytes = 64 hex chars
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn test_hash_token_differs_for_different_inputs() {
        let h1 = hash_token("token-a");
        let h2 = hash_token("token-b");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_create_and_validate_session() {
        let db = Db::in_memory().expect("in-memory db");
        let user = db
            .create_user("Alice", "alice@example.com", None, false, None)
            .unwrap();

        let token = create_session(&db, &user.id).unwrap();
        assert_eq!(token.len(), 64);

        let found = validate_session(&db, &token).unwrap();
        assert_eq!(found.id, user.id);
        assert_eq!(found.email, "alice@example.com");
    }

    #[test]
    fn test_validate_session_rejects_bad_token() {
        let db = Db::in_memory().expect("in-memory db");
        let user = db
            .create_user("Bob", "bob@example.com", None, false, None)
            .unwrap();
        let _token = create_session(&db, &user.id).unwrap();

        let result = validate_session(&db, "not-a-real-token");
        assert!(result.is_err());
    }

    #[test]
    fn test_create_and_accept_invite() {
        let db = Db::in_memory().expect("in-memory db");

        // Create a board and two users
        let board = db.create_board("Team Board", None).unwrap();
        let owner = db
            .create_user("Owner", "owner@example.com", None, false, None)
            .unwrap();
        let invitee = db
            .create_user("Invitee", "invitee@example.com", None, false, None)
            .unwrap();

        // Owner creates an invite
        let invite_token =
            create_invite_link(&db, &board.id, "member", &owner.id).unwrap();
        assert_eq!(invite_token.len(), 64);

        // Invitee accepts
        accept_invite(&db, &invite_token, &invitee.id).unwrap();

        // Verify board_members row exists
        let role: String = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT role FROM board_members WHERE board_id = ?1 AND user_id = ?2",
                    params![board.id, invitee.id],
                    |row| row.get(0),
                )
                .context("query board_members")
            })
            .unwrap();
        assert_eq!(role, "member");
    }

    #[test]
    fn test_accept_invite_rejects_bad_token() {
        let db = Db::in_memory().expect("in-memory db");
        let user = db
            .create_user("Alice", "alice@example.com", None, false, None)
            .unwrap();

        let result = accept_invite(&db, "nonexistent-token", &user.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_api_key_format() {
        let (raw, hash, prefix) = generate_api_key();
        assert!(raw.starts_with("ok_"));
        assert_eq!(raw.len(), 67); // "ok_" (3) + 64 hex
        assert_eq!(hash.len(), 64);
        assert_eq!(prefix.len(), 10);
        assert!(prefix.starts_with("ok_"));
    }
}
