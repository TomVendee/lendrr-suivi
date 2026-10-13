use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{AppState, current_user};

#[derive(Deserialize)]
pub struct LoginIn {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct Me {
    pub id: uuid::Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
}

pub async fn login(
    State(s): State<AppState>,
    Json(input): Json<LoginIn>,
) -> impl IntoResponse {
    let row: Option<(uuid::Uuid, String, String, String)> =
        sqlx::query_as("SELECT id, name, password_hash, role FROM users WHERE email = $1")
            .bind(input.email.trim())
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    let Some((id, name, hash, role)) = row else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid-credentials"})))
            .into_response();
    };
    if !crate::auth::verify_password(&hash, &input.password) {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "invalid-credentials"})))
            .into_response();
    }
    let sid: uuid::Uuid = sqlx::query_scalar("INSERT INTO sessions (user_id) VALUES ($1) RETURNING id")
        .bind(id)
        .fetch_one(&s.pool)
        .await
        .unwrap();
    let cookie = format!("sid={sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000");
    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    (StatusCode::OK, headers, Json(json!({"id": id, "name": name, "role": role}))).into_response()
}

pub async fn logout(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(sid) = super::session_cookie(&headers) {
        if let Ok(sid) = sid.parse::<uuid::Uuid>() {
            let _ = sqlx::query("DELETE FROM sessions WHERE id = $1")
                .bind(sid)
                .execute(&s.pool)
                .await;
        }
    }
    let mut h = HeaderMap::new();
    h.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"),
    );
    (StatusCode::OK, h, Json(json!({"ok": true}))).into_response()
}

pub async fn me(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let row: Option<(uuid::Uuid, String, String, String)> =
        sqlx::query_as("SELECT id, name, email::text, role FROM users WHERE id = $1")
            .bind(uid)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    match row {
        Some((id, name, email, role)) => (StatusCode::OK, Json(Me { id, name, email, role })).into_response(),
        None => (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response(),
    }
}

/// Crée un token API/MCP personnel, affiché **une seule fois** (D18).
/// Stocké hashé SHA-256, révocable. Sert aussi au MCP (`Authorization: Bearer`).
pub async fn create_token(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    use base64::Engine;
    use rand::RngCore;
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let token = format!("ls_{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw));
    let digest = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(token.as_bytes()))
    };
    let _ = sqlx::query("INSERT INTO api_tokens (user_id, token_hash) VALUES ($1,$2)")
        .bind(uid)
        .bind(digest)
        .execute(&s.pool)
        .await;
    (StatusCode::CREATED, Json(json!({"token": token}))).into_response()
}
