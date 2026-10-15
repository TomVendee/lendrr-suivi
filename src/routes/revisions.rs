use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::validation::{can_validate, valid_axis};

/// F11 : file des tâches proposées / modifications en attente (pilote).
pub async fn list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    type Row = (uuid::Uuid, Option<uuid::Uuid>, serde_json::Value, String, Option<uuid::Uuid>, chrono::DateTime<chrono::Utc>);
    let rows: Vec<Row> =
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

/// Retouche une révision en attente avant de la valider (pilote).
/// Le payload suit le même schéma que la création (titre, axis_code, dates,
/// done_criteria, milestone, assignments[]) ; refusé si pas exactement 1 lead.
pub async fn update_payload(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let leads = payload
        .get("assignments")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter(|x| x.get("role").and_then(|v| v.as_str()) == Some("lead")).count())
        .unwrap_or(0);
    if !crate::domain::validation::can_validate(leads) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "need-exactly-one-lead"}))).into_response();
    }
    // Mêmes règles qu'à la création : titre, axe, dates, rôles, heures.
    let ok = payload.get("title").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false)
        && payload.get("axis_code").and_then(|v| v.as_str()).map(valid_axis).unwrap_or(false)
        && match (
            payload.get("start_date").and_then(|v| v.as_str()).and_then(|s| s.parse::<chrono::NaiveDate>().ok()),
            payload.get("end_date").and_then(|v| v.as_str()).and_then(|s| s.parse::<chrono::NaiveDate>().ok()),
        ) {
            (Some(s), Some(e)) => e >= s,
            _ => false,
        }
        && payload.get("assignments").and_then(|v| v.as_array()).map(|a| {
            a.iter().all(|x| {
                matches!(x.get("role").and_then(|v| v.as_str()), Some("lead" | "support"))
                    && x.get("planned_hours").and_then(|v| v.as_f64()).map(|h| h >= 0.0).unwrap_or(false)
            })
        }).unwrap_or(false);
    if !ok {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-payload"}))).into_response();
    }
    let n = sqlx::query("UPDATE task_revisions SET payload=$1 WHERE id=$2 AND status='pending'")
        .bind(payload)
        .bind(id)
        .execute(&s.pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if n == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    }
    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

/// Applique un payload validé : crée la tâche ou met à jour le publié, en transaction.
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
    if title.is_empty() || end < start || !valid_axis(axis) {
        return Err("invalid-payload");
    }
    let assigns = p.get("assignments").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let leads = assigns.iter().filter(|a| a.get("role").and_then(|v| v.as_str()) == Some("lead")).count();
    if !can_validate(leads) {
        return Err("need-exactly-one-lead");
    }
    let mut tx = pool.begin().await.map_err(|_| "db")?;
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
            .execute(&mut *tx)
            .await
            .map(|r| r.rows_affected())
            .unwrap_or(0);
            if n == 0 {
                return Err("task-gone");
            }
            sqlx::query("DELETE FROM assignments WHERE task_id=$1")
                .bind(t)
                .execute(&mut *tx)
                .await
                .map_err(|_| "db")?;
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
            .fetch_one(&mut *tx)
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
        sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(auid)
        .bind(a.get("role").and_then(|v| v.as_str()).unwrap_or("support"))
        .bind(hours)
        .execute(&mut *tx)
        .await
        .map_err(|_| "bad-assignee")?;
    }
    tx.commit().await.map_err(|_| "db")?;
    Ok(id)
}
