use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::validation::can_validate;

/// F11 : file des tâches proposées / modifications en attente (pilote).
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let rows: Vec<(uuid::Uuid, Option<uuid::Uuid>, serde_json::Value, String, Option<uuid::Uuid>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT id, task_id, payload, status, created_by, created_at FROM task_revisions WHERE status='pending' ORDER BY created_at")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let out: Vec<_> = rows
        .iter()
        .map(|(id, tid, p, st, by, at)| {
            json!({"id": id, "task_id": tid, "payload": p, "status": st, "created_by": by, "created_at": at})
        })
        .collect();
    (StatusCode::OK, Json(json!({"revisions": out}))).into_response()
}

#[derive(Deserialize)]
pub struct DecideIn {
    pub approve: bool,
}

/// Valider (publie) ou rejeter. Création membre → la tâche naît ; modification →
/// l'ancienne version reste en vigueur jusqu'ici. Refus si pas exactement 1 lead.
pub async fn decide(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(input): Json<DecideIn>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let row: Option<(Option<uuid::Uuid>, serde_json::Value)> =
        sqlx::query_as("SELECT task_id, payload FROM task_revisions WHERE id=$1 AND status='pending'")
            .bind(id)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    let Some((task_id, payload)) = row else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    };
    if !input.approve {
        let _ = sqlx::query("UPDATE task_revisions SET status='rejected' WHERE id=$1")
            .bind(id).execute(&s.pool).await;
        return (StatusCode::OK, Json(json!({"ok": true, "decision": "rejected"}))).into_response();
    }
    match apply_payload(&s.pool, task_id, &payload).await {
        Ok(new_id) => {
            let _ = sqlx::query("UPDATE task_revisions SET status='validated' WHERE id=$1")
                .bind(id).execute(&s.pool).await;
            (StatusCode::OK, Json(json!({"ok": true, "decision": "validated", "task_id": new_id}))).into_response()
        }
        Err(reason) => (StatusCode::BAD_REQUEST, Json(json!({"error": reason}))).into_response(),
    }
}

pub async fn apply_payload(
    pool: &sqlx::PgPool,
    task_id: Option<uuid::Uuid>,
    p: &serde_json::Value,
) -> Result<uuid::Uuid, &'static str> {
    let title = p.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
    let axis = p.get("axis_code").and_then(|v| v.as_str()).unwrap_or("");
    let start: chrono::NaiveDate = p
        .get("start_date").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())
        .ok_or("bad-dates")?;
    let end: chrono::NaiveDate = p
        .get("end_date").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())
        .ok_or("bad-dates")?;
    if title.is_empty() || end < start || !matches!(axis, "HARD" | "SOFT" | "IA" | "PILOTAGE" | "VIDEO") {
        return Err("invalid-payload");
    }
    let assigns = p.get("assignments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let leads = assigns.iter().filter(|a| a.get("role").and_then(|v| v.as_str()) == Some("lead")).count();
    if !can_validate(leads) {
        return Err("need-exactly-one-lead");
    }
    let id = match task_id {
        Some(t) => {
            let n = sqlx::query(
                "UPDATE tasks SET title=$1, axis_code=$2, start_date=$3, end_date=$4,
                 done_criteria=$5, milestone=$6 WHERE id=$7",
            )
            .bind(title)
            .bind(axis)
            .bind(start)
            .bind(end)
            .bind(p.get("done_criteria").and_then(|v| v.as_str()).unwrap_or(""))
            .bind(p.get("milestone").and_then(|v| v.as_bool()).unwrap_or(false))
            .bind(t)
            .execute(pool)
            .await
            .map(|r| r.rows_affected())
            .unwrap_or(0);
            if n == 0 {
                return Err("task-gone");
            }
            let _ = sqlx::query("DELETE FROM assignments WHERE task_id=$1").bind(t).execute(pool).await;
            t
        }
        None => {
            sqlx::query_scalar(
                "INSERT INTO tasks (title, axis_code, start_date, end_date, done_criteria, milestone)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
            )
            .bind(title)
            .bind(axis)
            .bind(start)
            .bind(end)
            .bind(p.get("done_criteria").and_then(|v| v.as_str()).unwrap_or(""))
            .bind(p.get("milestone").and_then(|v| v.as_bool()).unwrap_or(false))
            .fetch_one(pool)
            .await
            .map_err(|_| "insert-failed")?
        }
    };
    for a in &assigns {
        let auid: uuid::Uuid = a
            .get("user_id").and_then(|v| v.as_str()).and_then(|x| x.parse().ok())
            .ok_or("bad-assignee")?;
        let hours = a.get("planned_hours").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if hours < 0.0 {
            return Err("negative-hours");
        }
        let _ = sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(auid)
        .bind(a.get("role").and_then(|v| v.as_str()).unwrap_or("support"))
        .bind(hours)
        .execute(pool)
        .await;
    }
    Ok(id)
}
