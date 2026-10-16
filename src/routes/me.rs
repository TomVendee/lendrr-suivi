use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use validator::Validate;

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

/// E-mail + mot de passe (D8) : ouvre une session 30 jours, cookie HttpOnly/Lax.
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
    let sid: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO sessions (user_id, expires_at) VALUES ($1, now() + interval '30 days') RETURNING id",
    )
    .bind(id)
    .fetch_one(&s.pool)
    .await
    .unwrap();
    let secure = if s.secure_cookies { "; Secure" } else { "" };
    let cookie = format!("sid={sid}; Path=/; HttpOnly{secure}; SameSite=Lax; Max-Age=2592000");
    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    (StatusCode::OK, headers, Json(json!({"id": id, "name": name, "role": role}))).into_response()
}

/// Ferme la session (cookie + ligne en base).
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
    let clear = format!(
        "sid=; Path=/; HttpOnly{}; SameSite=Lax; Max-Age=0",
        if s.secure_cookies { "; Secure" } else { "" }
    );
    h.insert(header::SET_COOKIE, HeaderValue::from_str(&clear).unwrap());
    (StatusCode::OK, h, Json(json!({"ok": true}))).into_response()
}

/// Profil courant (cookie `sid` ou token `Bearer`).
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

#[derive(Deserialize, Validate)]
pub struct ChangePasswordIn {
    pub current: String,
    #[validate(length(min = 10))]
    pub new: String,
}

/// Changement de son propre mot de passe : exige l'ancien, ferme les autres sessions.
pub async fn change_password(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<ChangePasswordIn>) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if input.validate().is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    let hash: Option<String> = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(uid)
        .fetch_optional(&s.pool)
        .await
        .unwrap_or(None);
    if !hash.is_some_and(|h| crate::auth::verify_password(&h, &input.current)) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "wrong-password"}))).into_response();
    }
    let _ = sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(crate::auth::hash_password(&input.new))
        .bind(uid)
        .execute(&s.pool)
        .await;
    let keep = super::session_cookie(&headers).and_then(|c| c.parse::<uuid::Uuid>().ok());
    let _ = sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2")
        .bind(uid)
        .bind(keep)
        .execute(&s.pool)
        .await;
    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

#[derive(Deserialize, Validate, Default)]
pub struct CreateTokenIn {
    #[validate(length(max = 60))]
    pub label: Option<String>,
}

/// Crée un token API/MCP personnel, affiché **une seule fois** (D18).
/// Stocké hashé SHA-256, révocable. Sert aussi au MCP (`Authorization: Bearer`).
/// Corps facultatif : `{"label": "Claude Code"}`.
pub async fn create_token(
    State(s): State<AppState>,
    headers: HeaderMap,
    input: Option<Json<CreateTokenIn>>,
) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let input = input.map(|Json(i)| i).unwrap_or_default();
    if input.validate().is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    use base64::Engine;
    use rand::RngCore;
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let token = format!("ls_{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw));
    let digest = super::sha256_hex(&token);
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO api_tokens (user_id, token_hash, label) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(uid)
    .bind(digest)
    .bind(input.label.unwrap_or_default().trim())
    .fetch_one(&s.pool)
    .await
    .unwrap();
    (StatusCode::CREATED, Json(json!({"id": id, "token": token}))).into_response()
}

/// Ses tokens actifs (jamais la valeur, seulement nom et date de création).
pub async fn list_tokens(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let rows: Vec<(uuid::Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT id, label, created_at FROM api_tokens WHERE user_id = $1 AND NOT revoked ORDER BY created_at DESC",
    )
    .bind(uid)
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let out: Vec<_> = rows
        .iter()
        .map(|(id, label, at)| json!({"id": id, "label": label, "created_at": at}))
        .collect();
    (StatusCode::OK, Json(out)).into_response()
}

/// Révoque un de ses tokens (D18). Le token cesse de fonctionner aussitôt.
pub async fn revoke_token(
    State(s): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<uuid::Uuid>,
) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let n = sqlx::query("UPDATE api_tokens SET revoked = TRUE WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(uid)
        .execute(&s.pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if n == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    }
    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

#[derive(Deserialize, Validate)]
pub struct CreateUserIn {
    #[validate(length(min = 1, max = 120))]
    pub name: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 10))]
    pub password: String,
    pub role: Option<String>,
    pub default_capacity_hours: Option<f64>,
}

/// Comptes créés par le chef de projet (D8). Pilote uniquement.
pub async fn create_user(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<CreateUserIn>) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    if input.validate().is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    let r = input.role.unwrap_or_else(|| "member".into());
    if r != "member" && r != "pilot" {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-role"}))).into_response();
    }
    let id: Option<uuid::Uuid> = sqlx::query_scalar(
        "INSERT INTO users (name, email, password_hash, role, default_capacity_hours)
         VALUES ($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(input.name.trim())
    .bind(input.email.trim())
    .bind(crate::auth::hash_password(&input.password))
    .bind(r)
    .bind(input.default_capacity_hours.unwrap_or(4.0))
    .fetch_optional(&s.pool)
    .await
    .unwrap_or(None);
    match id {
        Some(id) => (StatusCode::CREATED, Json(json!({"id": id}))).into_response(),
        None => (StatusCode::CONFLICT, Json(json!({"error": "email-taken"}))).into_response(),
    }
}

/// Annuaire (connecté uniquement) : résout les noms pour les collaborateurs, la charge, la météo.
pub async fn list_users(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let rows: Vec<(uuid::Uuid, String, String, String)> =
        sqlx::query_as("SELECT id, name, email::text, role FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let out: Vec<_> = rows
        .iter()
        .map(|(id, name, email, role)| json!({"id": id, "name": name, "email": email, "role": role}))
        .collect();
    (StatusCode::OK, Json(out)).into_response()
}
