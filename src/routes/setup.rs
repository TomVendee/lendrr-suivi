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
    let hash = crate::auth::hash_password(&input.password);
    // Atomique : le WHERE NOT EXISTS évite deux pilotes en cas de double POST.
    let id: Option<uuid::Uuid> = sqlx::query_scalar(
        "INSERT INTO users (name, email, password_hash, role)
         SELECT $1, $2, $3, 'pilot' WHERE NOT EXISTS (SELECT 1 FROM users)
         RETURNING id",
    )
    .bind(input.name.trim())
    .bind(input.email.trim())
    .bind(hash)
    .fetch_optional(&s.pool)
    .await
    .unwrap_or(None);
    match id {
        Some(id) => (StatusCode::CREATED, Json(json!({"id": id, "role": "pilot"}))).into_response(),
        None => {
            // Soit déjà initialisé, soit e-mail pris : on ne distingue pas (anti-énumération).
            (StatusCode::GONE, Json(json!({"error": "already-initialized"}))).into_response()
        }
    }
}
