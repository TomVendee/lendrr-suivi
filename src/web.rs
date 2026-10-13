use axum::{
    http::{StatusCode, Uri, header},
    response::IntoResponse,
};

const HELLO: &str = r#"<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suivi projet</title></head><body style="font-family:sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Suivi projet — socle OK</h1>
<p>Le front React n'est pas encore construit (<code>web/dist</code> absent).</p>
<ul><li><a href="/api/hello">/api/hello</a></li><li><a href="/health">/health</a></li><li><a href="/ready">/ready</a></li></ul>
</body></html>"#;

fn mime(path: &str) -> &'static str {
    if path.ends_with(".html") { "text/html; charset=utf-8" }
    else if path.ends_with(".js") { "text/javascript; charset=utf-8" }
    else if path.ends_with(".css") { "text/css; charset=utf-8" }
    else if path.ends_with(".svg") { "image/svg+xml" }
    else if path.ends_with(".json") { "application/json" }
    else if path.ends_with(".png") { "image/png" }
    else if path.ends_with(".ico") { "image/x-icon" }
    else if path.ends_with(".woff2") { "font/woff2" }
    else { "application/octet-stream" }
}

fn file(path: &str) -> Option<(StatusCode, [(axum::http::HeaderName, &'static str); 1], Vec<u8>)> {
    // Anti-remontée : le chemin reste sous web/dist.
    if path.contains("..") {
        return None;
    }
    let body = std::fs::read(format!("web/dist{path}")).ok()?;
    Some((StatusCode::OK, [(header::CONTENT_TYPE, mime(path))], body))
}

/// Sert `web/dist` (build Vite) avec les bons Content-Type, sinon la page hello.
/// SPA : toute route inconnue non-/api retombe sur `web/dist/index.html`.
pub async fn fallback(uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    if path.starts_with("/api/") || path == "/health" || path == "/ready" || path.starts_with("/mcp") {
        return (StatusCode::NOT_FOUND, [(header::CONTENT_TYPE, "text/html")], format!("<h1>404</h1><p>{path} inconnu</p>").into_bytes()).into_response();
    }
    if path != "/" {
        if let Some(f) = file(path) {
            return f.into_response();
        }
        if let Some(mut f) = file("/index.html") {
            f.0 = StatusCode::OK;
            return f.into_response();
        }
    } else if let Some(f) = file("/index.html") {
        return f.into_response();
    }
    (StatusCode::OK, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], HELLO.as_bytes().to_vec()).into_response()
}
