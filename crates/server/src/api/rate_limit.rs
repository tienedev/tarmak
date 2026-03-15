use axum::{
    body::Body,
    extract::Extension,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
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
}

fn extract_client_ip(req: &Request<Body>) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
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
