use axum::{
    Router,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
};
use serde_json::json;
use sqlx::PgPool;

pub(crate) mod deps;
pub(crate) mod import;
pub(crate) mod me;
pub(crate) mod report;
pub(crate) mod revisions;
pub(crate) mod settings;
pub(crate) mod setup;
pub(crate) mod stats;
pub(crate) mod tasks;
pub(crate) mod views;
pub(crate) mod week;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub setup_code: Option<String>,
    /// `Secure` sur les cookies sauf en http local (ne change rien en prod https).
    pub secure_cookies: bool,
}

/// Routeur : état construit depuis la config lue dans l'environnement.
pub fn router(pool: PgPool, cfg: crate::config::Config) -> Router {
    let state = AppState {
        pool: pool.clone(),
        setup_code: cfg.setup_code,
        secure_cookies: cfg.secure_cookies,
    };
    let mcp_service = crate::mcp::streamable_service(pool, cfg.app_host);
    build(state, mcp_service)
}

fn build(state: AppState, mcp_service: crate::mcp::McpService) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/api/hello", get(hello))
        .route("/api/me", get(me::me))
        .route("/api/login", post(me::login))
        .route("/api/logout", post(me::logout))
        .route("/api/me/password", post(me::change_password))
        .route("/api/tokens", post(me::create_token).get(me::list_tokens))
        .route("/api/tokens/{id}", delete(me::revoke_token))
        .route("/api/users", post(me::create_user).get(me::list_users))
        .route("/setup", post(setup::setup))
        .route("/api/tasks", get(tasks::list).post(tasks::create))
        .route("/api/tasks/{id}", get(tasks::get).put(tasks::update))
        .route("/api/tasks/{id}/status", post(tasks::set_status))
        .route("/api/tasks/{id}/comments", get(tasks::comments).post(tasks::add_comment))
        .route("/api/axes", get(tasks::axes))
        .route("/api/dependencies", post(deps::create).delete(deps::delete))
        .route("/api/my-week", get(week::my_week))
        .route("/api/time-entries", post(week::log_hours))
        .route("/api/import", post(import::import_asana))
        .route("/api/load", get(stats::load))
        .route("/api/capacities", get(stats::capacities).put(stats::set_capacity))
        .route("/api/alerts", get(stats::alerts))
        .route("/api/graphs", get(stats::graphs))
        .route("/api/gantt", get(views::gantt))
        .route("/api/meteo", get(views::meteo))
        .route("/api/settings", get(settings::get).put(settings::update))
        .route("/api/revisions", get(revisions::list))
        .route("/api/revisions/{id}", put(revisions::update_payload))
        .route("/api/revisions/{id}/validate", post(revisions::decide))
        .route("/api/baselines", post(report::take_baseline))
        .route("/api/synthesis", get(report::synthesis))
        .route("/api/export", get(report::export))
        .merge(
            Router::new()
                .nest_service("/mcp", mcp_service)
                .layer(axum::middleware::from_fn_with_state(state.clone(), require_token)),
        )
        .fallback(crate::web::fallback)
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(json!({"status": "ok", "app": "lendrr-suivi"}))
}

async fn ready(
    axum::extract::State(s): axum::extract::State<AppState>,
) -> impl IntoResponse {
    match sqlx::query("SELECT 1").fetch_one(&s.pool).await {
        Ok(_) => (StatusCode::OK, Json(json!({"status": "ready"}))).into_response(),
        Err(e) => {
            tracing::warn!("not ready: {e}");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status": "not-ready"}))).into_response()
        }
    }
}

async fn hello() -> impl IntoResponse {
    // `sha` : commit de l'image en service (build-arg GIT_SHA), lu par la CD pour confirmer le déploiement.
    let sha = std::env::var("GIT_SHA").unwrap_or_else(|_| "dev".into());
    Json(json!({"name": "Suivi projet", "version": env!("CARGO_PKG_VERSION"), "sha": sha}))
}

/// Barrière du MCP : aucune méthode (`initialize`, `tools/list`, `tools/call`) sans token valide non révoqué.
async fn require_token(
    axum::extract::State(s): axum::extract::State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let ok = match bearer(req.headers()) {
        Some(t) => sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM api_tokens WHERE token_hash = $1 AND NOT revoked)",
        )
        .bind(sha256_hex(&t))
        .fetch_one(&s.pool)
        .await
        .unwrap_or(false),
        None => false,
    };
    if ok {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [(axum::http::header::WWW_AUTHENTICATE, "Bearer")],
            Json(json!({"error": "unauthorized"})),
        )
            .into_response()
    }
}

/// Extrait le `sid` du cookie, sans jamais lever.
pub fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|c| {
            let (k, v) = c.trim().split_once('=')?;
            (k.trim() == "sid").then(|| v.trim().to_string())
        })
        .next()
}

/// Extrait le token de `Authorization: Bearer`, sans jamais lever.
pub fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")?
        .to_string()
        .into()
}

/// Authentifie via cookie `sid` (web) ou `Authorization: Bearer` (token API/MCP).
/// Retourne (user_id, role).
pub async fn current_user(
    pool: &PgPool,
    headers: &HeaderMap,
) -> Result<(uuid::Uuid, String), StatusCode> {
    if let Some(sid) = session_cookie(headers) {
        let sid: uuid::Uuid = sid.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
        let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
            "SELECT u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.id = $1 AND s.expires_at > now()",
        )
        .bind(sid)
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
        if let Some(r) = row {
            return Ok(r);
        }
    }
    if let Some(tok) = bearer(headers) {
        let digest = sha256_hex(&tok);
        let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
            "SELECT u.id, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id
             WHERE t.token_hash = $1 AND NOT t.revoked",
        )
        .bind(digest)
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
        if let Some(r) = row {
            return Ok(r);
        }
    }
    Err(StatusCode::UNAUTHORIZED)
}

pub(crate) fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
