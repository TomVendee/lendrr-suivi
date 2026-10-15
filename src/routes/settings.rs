use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use validator::Validate;

use super::{AppState, current_user};
use crate::domain::{alerts::Thresholds, validation};

/// Réglages du pilote (ligne unique `settings`, id = 1). `project_start` reste fixe (D21).
#[derive(sqlx::FromRow, Serialize, Deserialize, Validate)]
pub struct Settings {
    pub validation_enabled: bool,
    pub revalidate_on_edit: bool,
    pub members_can_propose: bool,
    pub validator_id: Option<uuid::Uuid>,
    pub deputy_id: Option<uuid::Uuid>,
    #[validate(range(min = 1, max = 14))]
    pub reminder_days: Option<i32>,
    pub hours_mode: String,
    #[validate(range(min = 0.0, max = 2.0))]
    pub overrun_pct: f64,
    #[validate(range(min = 0.0, max = 20.0))]
    pub overrun_hours: f64,
    #[validate(range(min = 1, max = 30))]
    pub blocking_days: i32,
}

impl Default for Settings {
    fn default() -> Self {
        let t = Thresholds::default();
        Self {
            validation_enabled: true,
            revalidate_on_edit: true,
            members_can_propose: true,
            validator_id: None,
            deputy_id: None,
            reminder_days: Some(2),
            hours_mode: "per_person".into(),
            overrun_pct: t.overrun_pct,
            overrun_hours: t.overrun_hours,
            blocking_days: t.blocking_days as i32,
        }
    }
}

impl Settings {
    pub fn thresholds(&self) -> Thresholds {
        Thresholds {
            overrun_pct: self.overrun_pct,
            overrun_hours: self.overrun_hours,
            blocking_days: self.blocking_days as i64,
        }
    }

    pub fn can_decide(&self, uid: uuid::Uuid, role: &str) -> bool {
        validation::can_decide(uid, role == "pilot", self.validator_id, self.deputy_id)
    }
}

/// Lit les réglages ; en cas d'erreur, les défauts (validation active : choix prudent).
pub async fn load(pool: &sqlx::PgPool) -> Settings {
    sqlx::query_as(
        "SELECT validation_enabled, revalidate_on_edit, members_can_propose, validator_id, deputy_id,
                reminder_days, hours_mode, overrun_pct, overrun_hours, blocking_days
         FROM settings WHERE id = 1",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_default()
}

/// Réglages + droit de valider de l'appelant. Connecté uniquement (le front en a besoin partout).
pub async fn get(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let st = load(&s.pool).await;
    let can_decide = st.can_decide(uid, &role);
    let mut out = serde_json::to_value(st).unwrap_or_default();
    out["can_decide"] = json!(can_decide);
    (StatusCode::OK, Json(out)).into_response()
}

/// Enregistre les réglages (pilote).
pub async fn update(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Settings>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    if input.validate().is_err() || !matches!(input.hours_mode.as_str(), "per_person" | "equal_split") {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    let res = sqlx::query(
        "UPDATE settings SET validation_enabled=$1, revalidate_on_edit=$2, members_can_propose=$3,
                validator_id=$4, deputy_id=$5, reminder_days=$6, hours_mode=$7,
                overrun_pct=$8, overrun_hours=$9, blocking_days=$10
         WHERE id = 1",
    )
    .bind(input.validation_enabled)
    .bind(input.revalidate_on_edit)
    .bind(input.members_can_propose)
    .bind(input.validator_id)
    .bind(input.deputy_id)
    .bind(input.reminder_days)
    .bind(&input.hours_mode)
    .bind(input.overrun_pct)
    .bind(input.overrun_hours)
    .bind(input.blocking_days)
    .execute(&s.pool)
    .await;
    match res {
        Ok(_) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        // FK : validateur ou suppléant inconnu.
        Err(_) => (StatusCode::BAD_REQUEST, Json(json!({"error": "unknown-user"}))).into_response(),
    }
}
