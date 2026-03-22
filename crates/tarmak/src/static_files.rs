use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../frontend/dist"]
struct StaticAssets;

pub async fn static_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match StaticAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(axum::body::Body::from(content.data.to_vec()))
                .unwrap()
        }
        None => {
            // SPA fallback: serve index.html for unmatched routes
            match StaticAssets::get("index.html") {
                Some(content) => Response::builder()
                    .header(header::CONTENT_TYPE, "text/html")
                    .body(axum::body::Body::from(content.data.to_vec()))
                    .unwrap(),
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(axum::body::Body::from("Not Found"))
                    .unwrap(),
            }
        }
    }
}
