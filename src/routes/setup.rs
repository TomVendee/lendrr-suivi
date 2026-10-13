use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;
use serde_json::json;
use validator::Validate;

use super::AppState;

/// Premier compte : actif seulement tant qu'aucun utilisateur n'existe (D9).
/// Protégé par SETUP_CODE. Le compte créé est `pilot`.
#[derive(Deserialize, Validate)]
pub struct SetupIn {
    pub code: String,
    #[validate(length(min = 1, max = 120))]
    pub name: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 10))]
    pub password: String,
}

pub async fn setup(State(s): State<AppState>, Json(input): Json<SetupIn>) -> impl IntoResponse {
    if input.validate().is_err() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    let expected = s.setup_code.clone().unwrap_or_default();
    if expected.is_empty() || input.code != expected {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "bad-code"}))).into_response();
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&s.pool)
        .await
        .unwrap_or(1);
    if count > 0 {
        return (StatusCode::GONE, Json(json!({"error": "already-initialized"}))).into_response();
    }
    let hash = crate::auth::hash_password(&input.password);
    let id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'pilot') RETURNING id",
    )
    .bind(input.name.trim())
    .bind(input.email.trim())
    .bind(hash)
    .fetch_one(&s.pool)
    .await
    .map_err(|_| ())
    .unwrap_or_else(|_| uuid::Uuid::nil());
    if id.is_nil() {
        return (StatusCode::CONFLICT, Json(json!({"error": "email-taken"}))).into_response();
    }
    (StatusCode::CREATED, Json(json!({"id": id, "role": "pilot"}))).into_response()
}
