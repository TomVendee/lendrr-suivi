use axum::{
    Router,
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json},
    routing::{delete, get, post},
};
use serde_json::json;
use sqlx::PgPool;

mod deps;
mod import;
mod me;
mod setup;
mod stats;
mod tasks;
mod week;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub setup_code: Option<String>,
}

pub fn router(pool: PgPool) -> Router {
    router_with_code(pool, std::env::var("SETUP_CODE").ok().filter(|s| !s.is_empty()))
}

pub fn router_with_code(pool: PgPool, setup_code: Option<String>) -> Router {
    let state = AppState { pool: pool.clone(), setup_code };
    let mcp_service = crate::mcp::streamable_service(pool);
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/api/hello", get(hello))
        .route("/api/me", get(me::me))
        .route("/api/login", post(me::login))
        .route("/api/logout", post(me::logout))
        .route("/api/tokens", post(me::create_token))
        .route("/setup", post(setup::setup))
        .route("/api/tasks", get(tasks::list).post(tasks::create))
        .route("/api/tasks/{id}", get(tasks::get).put(tasks::update))
        .route("/api/tasks/{id}/status", post(tasks::set_status))
        .route("/api/axes", get(tasks::axes))
        .route("/api/dependencies", post(deps::create).delete(deps::delete))
        .route("/api/my-week", get(week::my_week))
        .route("/api/time-entries", post(week::log_hours))
        .route("/api/import", post(import::import_asana))
        .route("/api/load", get(stats::load))
        .route("/api/alerts", get(stats::alerts))
        .nest_service("/mcp", mcp_service)
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
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "not-ready", "detail": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hello() -> impl IntoResponse {
    Json(json!({"name": "Suivi projet", "version": env!("CARGO_PKG_VERSION")}))
}

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
            "SELECT u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
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

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

pub fn _html() -> Html<&'static str> {
    Html("<h1>unused</h1>")
}
