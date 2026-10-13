use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;

use super::{AppState, current_user};
use crate::domain::deps::would_cycle;

#[derive(Deserialize)]
pub struct AssigneeIn {
    pub email: String,
    pub role: String,
    pub hours: f64,
}

#[derive(Deserialize)]
pub struct TaskIn {
    pub key: String,
    pub title: String,
    pub axis: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub status: Option<String>,
    pub criteria: Option<String>,
    pub milestone: Option<bool>,
    pub assignees: Vec<AssigneeIn>,
    pub depends_on: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct ImportIn {
    pub tasks: Vec<TaskIn>,
}

fn valid_axis(code: &str) -> bool {
    matches!(code, "HARD" | "SOFT" | "IA" | "PILOTAGE" | "VIDEO")
}

/// F4 : import Asana rejouable (upsert sur external_key), rapport créé/mis à jour/ignoré/erreurs.
pub async fn import_asana(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ImportIn>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }

    let users: Vec<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, email::text FROM users")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let by_email: HashMap<String, uuid::Uuid> =
        users.into_iter().map(|(id, e)| (e.to_lowercase(), id)).collect();

    let mut created = 0;
    let mut updated = 0;
    let mut skipped = 0;
    let mut errors = vec![];
    // key -> id (existants + créés), pour résoudre les dépendances après.
    let mut ids: HashMap<String, uuid::Uuid> = HashMap::new();
    let existing: Vec<(String, uuid::Uuid)> =
        sqlx::query_as("SELECT external_key, id FROM tasks WHERE external_key IS NOT NULL")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    for (k, id) in existing {
        ids.insert(k, id);
    }

    // Passe 1 : tâches.
    let mut pending_deps: Vec<(String, Vec<String>)> = vec![];
    for t in &input.tasks {
        let status = t.status.clone().unwrap_or_else(|| "todo".into());
        let milestone = t.milestone.unwrap_or(false);
        let valid = !t.key.is_empty()
            && !t.title.trim().is_empty()
            && valid_axis(&t.axis)
            && t.end >= t.start
            && matches!(status.as_str(), "todo" | "in_progress" | "blocked" | "done")
            && t.assignees.iter().filter(|a| a.role == "lead").count() == 1
            && t.assignees.iter().all(|a| a.role == "lead" || a.role == "support")
            && t.assignees.iter().all(|a| a.hours >= 0.0)
            && t.assignees.iter().all(|a| by_email.contains_key(&a.email.to_lowercase()));
        if !valid {
            errors.push(json!({"key": t.key, "reason": "invalid-task-check-axis-dates-status-lead-emails"}));
            continue;
        }
        let id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO tasks (title, axis_code, start_date, end_date, status, done_criteria, milestone, external_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (external_key) DO UPDATE SET
               title=EXCLUDED.title, axis_code=EXCLUDED.axis_code,
               start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
               status=EXCLUDED.status, done_criteria=EXCLUDED.done_criteria,
               milestone=EXCLUDED.milestone
             RETURNING id",
        )
        .bind(t.title.trim())
        .bind(&t.axis)
        .bind(t.start)
        .bind(t.end)
        .bind(&status)
        .bind(t.criteria.clone().unwrap_or_default())
        .bind(milestone)
        .bind(&t.key)
        .fetch_one(&s.pool)
        .await
        .unwrap_or_else(|_| uuid::Uuid::nil());
        if id.is_nil() {
            errors.push(json!({"key": t.key, "reason": "insert-failed"}));
            continue;
        }
        let was_new = !ids.contains_key(&t.key);
        ids.insert(t.key.clone(), id);
        if was_new { created += 1; } else { updated += 1; }

        let _ = sqlx::query("DELETE FROM assignments WHERE task_id=$1").bind(id).execute(&s.pool).await;
        for a in &t.assignees {
            let _ = sqlx::query(
                "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
            )
            .bind(id)
            .bind(by_email[&a.email.to_lowercase()])
            .bind(&a.role)
            .bind(a.hours)
            .execute(&s.pool)
            .await;
        }
        if let Some(d) = &t.depends_on {
            if !d.is_empty() {
                pending_deps.push((t.key.clone(), d.clone()));
            }
        }
    }

    // Passe 2 : dépendances (clés toutes connues, cycles refusés un par un).
    let mut dep_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT pred_id::text, succ_id::text FROM dependencies")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    for (key, want) in pending_deps {
        let Some(succ) = ids.get(&key) else { continue };
        for pk in want {
            let Some(pred) = ids.get(&pk) else {
                errors.push(json!({"key": key, "reason": format!("unknown-dependency-{pk}")}));
                continue;
            };
            if would_cycle(&dep_rows, &pred.to_string(), &succ.to_string()) {
                errors.push(json!({"key": key, "reason": format!("cycle-refused-{pk}")}));
                skipped += 1;
                continue;
            }
            let _ = sqlx::query(
                "INSERT INTO dependencies (pred_id, succ_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(*pred)
            .bind(*succ)
            .execute(&s.pool)
            .await;
            dep_rows.push((pred.to_string(), succ.to_string()));
        }
    }

    (
        StatusCode::OK,
        Json(json!({"created": created, "updated": updated, "skipped": skipped, "errors": errors})),
    )
        .into_response()
}
