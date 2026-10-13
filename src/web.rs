use axum::{http::Uri, response::{Html, IntoResponse}};

const HELLO: &str = r#"<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suivi projet</title></head><body style="font-family:sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Suivi projet — socle OK</h1>
<p>Le serveur Rust répond. Prochaines étapes : F1 (tâches), puis écrans React.</p>
<ul><li><a href="/api/hello">/api/hello</a></li><li><a href="/health">/health</a></li><li><a href="/ready">/ready</a></li></ul>
</body></html>"#;

/// Sert `web/dist` si présent (build Vite futur), sinon la page hello du socle.
/// Quand le front React arrivera, ses fichiers prendront le relais sans changer le serveur.
pub async fn fallback(uri: Uri) -> impl IntoResponse {
    let path = uri.path();
    if path.starts_with("/api/") || path == "/health" || path == "/ready" || path == "/mcp" {
        return Html(format!("<h1>404</h1><p>{path} inconnu</p>")).into_response();
    }
    if let Ok(body) = std::fs::read_to_string(format!("web/dist{path}")) {
        return Html(body).into_response();
    }
    if path != "/" {
        if let Ok(index) = std::fs::read_to_string("web/dist/index.html") {
            return Html(index).into_response();
        }
    }
    Html(HELLO.to_string()).into_response()
}
