use axum::{
    body::Body,
    extract::{ConnectInfo, Extension},
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Simple in-memory per-IP rate limiter.
#[derive(Clone)]
pub struct RateLimiter {
    state: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
    max_requests: usize,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window_secs: u64) -> Self {
        Self {
            state: Arc::new(Mutex::new(HashMap::new())),
            max_requests,
            window_secs,
        }
    }

    fn check(&self, ip: &str) -> bool {
        let mut map = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);

        let timestamps = map.entry(ip.to_string()).or_default();
        timestamps.retain(|t| now.duration_since(*t) < window);

        if timestamps.len() >= self.max_requests {
            false
        } else {
            timestamps.push(now);
            true
        }
    }

    /// Remove all stale entries: prune old timestamps, then drop empty entries.
    /// Returns the number of IPs removed.
    pub fn sweep(&self) -> usize {
        let mut map = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);

        // First pass: prune old timestamps from all entries
        for timestamps in map.values_mut() {
            timestamps.retain(|t| now.duration_since(*t) < window);
        }

        // Second pass: remove entries with no remaining timestamps
        let before = map.len();
        map.retain(|_, v| !v.is_empty());
        before - map.len()
    }
}

fn extract_client_ip(req: &Request<Body>) -> String {
    // Always prefer actual TCP peer address to prevent rate-limit bypass
    // via spoofed X-Forwarded-For headers
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

pub async fn rate_limit_middleware(
    Extension(limiter): Extension<RateLimiter>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let ip = extract_client_ip(&req);
    if !limiter.check(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests. Please try again later.",
        )
            .into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_removes_stale_entries() {
        let limiter = RateLimiter::new(10, 1); // 1-second window
        assert!(limiter.check("1.2.3.4"));
        assert!(limiter.check("5.6.7.8"));
        assert_eq!(limiter.sweep(), 0);
        std::thread::sleep(std::time::Duration::from_millis(1100));
        assert_eq!(limiter.sweep(), 2);
    }

    #[test]
    fn sweep_preserves_active_entries() {
        let limiter = RateLimiter::new(10, 60); // 60-second window
        assert!(limiter.check("active-ip"));
        assert_eq!(limiter.sweep(), 0);
    }
}
