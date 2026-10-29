use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::{deps::would_cycle, shift::{Node, cascade_shift}};

#[derive(Deserialize, schemars::JsonSchema)]
pub struct DepIn {
    /// Prédécesseur : doit finir avant que le successeur commence.
    #[schemars(with = "String")]
    pub pred_id: uuid::Uuid,
    #[schemars(with = "String")]
    pub succ_id: uuid::Uuid,
}

async fn is_pilot(s: &AppState, h: &HeaderMap) -> bool {
    matches!(current_user(&s.pool, h).await, Ok((_, r)) if r == "pilot")
}

/// Lie deux tâches (fin-début). Pilote uniquement, cycle refusé (D13).
pub async fn create(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<DepIn>) -> impl IntoResponse {
    if !is_pilot(&s, &headers).await {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let existing: Vec<(String, String)> =
        sqlx::query_as("SELECT pred_id::text, succ_id::text FROM dependencies")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    if would_cycle(&existing, &input.pred_id.to_string(), &input.succ_id.to_string()) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "cycle-refused"}))).into_response();
    }
    let r = sqlx::query("INSERT INTO dependencies (pred_id, succ_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(input.pred_id)
        .bind(input.succ_id)
        .execute(&s.pool)
        .await;
    match r {
        Ok(_) => (StatusCode::CREATED, Json(json!({"ok": true}))).into_response(),
        Err(_) => (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-task-id"}))).into_response(),
    }
}

/// Délie deux tâches. Pilote uniquement.
pub async fn delete(State(s): State<AppState>, headers: HeaderMap, Json(input): Json<DepIn>) -> impl IntoResponse {
    if !is_pilot(&s, &headers).await {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let _ = sqlx::query("DELETE FROM dependencies WHERE pred_id=$1 AND succ_id=$2")
        .bind(input.pred_id)
        .bind(input.succ_id)
        .execute(&s.pool)
        .await;
    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

/// Applique le décalage en cascade après qu'une tâche a reculé.
/// Retourne les ids décalés + les jalons menacés (D13 : jalons jamais bougés).
pub async fn cascade_after_move(
    pool: &sqlx::PgPool,
    moved_id: uuid::Uuid,
    new_end: NaiveDate,
) -> (Vec<uuid::Uuid>, Vec<uuid::Uuid>) {
    let rows: Vec<(uuid::Uuid, NaiveDate, NaiveDate, bool)> =
        sqlx::query_as("SELECT id, start_date, end_date, milestone FROM tasks")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let nodes: Vec<Node> = rows
        .iter()
        .map(|(id, s, e, m)| Node { id: id.to_string(), start: *s, end: *e, milestone: *m })
        .collect();
    let dep_rows: Vec<(uuid::Uuid, uuid::Uuid)> =
        sqlx::query_as("SELECT pred_id, succ_id FROM dependencies")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let deps: Vec<(String, String)> = dep_rows
        .iter()
        .map(|(p, q)| (p.to_string(), q.to_string()))
        .collect();
    let (dates, threatened) = cascade_shift(&nodes, &deps, &moved_id.to_string(), new_end);
    let mut moved = vec![];
    for (id_str, (ns, ne)) in &dates {
        if id_str == &moved_id.to_string() {
            continue;
        }
        let Ok(id) = id_str.parse::<uuid::Uuid>() else { continue };
        let Some(before) = rows.iter().find(|(r, _, _, _)| r == &id) else { continue };
        if before.1 != *ns || before.2 != *ne {
            let _ = sqlx::query("UPDATE tasks SET start_date=$1, end_date=$2 WHERE id=$3")
                .bind(*ns)
                .bind(*ne)
                .bind(id)
                .execute(pool)
                .await;
            moved.push(id);
        }
    }
    let threatened_ids: Vec<uuid::Uuid> =
        threatened.iter().filter_map(|t| t.parse().ok()).collect();
    (moved, threatened_ids)
}
