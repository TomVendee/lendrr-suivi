use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use validator::Validate;

use super::{AppState, current_user};
use crate::domain::validation::can_validate;

#[derive(Serialize)]
pub struct AssignmentOut {
    pub user_id: uuid::Uuid,
    pub role: String,
    pub planned_hours: f64,
}

#[derive(Serialize)]
pub struct TaskOut {
    pub id: uuid::Uuid,
    pub title: String,
    pub axis_code: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub done_criteria: String,
    pub milestone: bool,
    pub assignments: Vec<AssignmentOut>,
}

#[derive(Deserialize)]
pub struct TaskFilters {
    pub axis: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize, Validate, Clone)]
pub struct AssignmentIn {
    pub user_id: uuid::Uuid,
    pub role: String,
    pub planned_hours: f64,
}

#[derive(Deserialize, Validate)]
pub struct TaskIn {
    #[validate(length(min = 1, max = 200))]
    pub title: String,
    pub axis_code: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    #[validate(length(max = 2000))]
    pub done_criteria: Option<String>,
    pub milestone: Option<bool>,
    pub assignments: Vec<AssignmentIn>,
}

#[derive(Deserialize)]
pub struct StatusIn {
    pub status: String,
}

fn valid_axis(code: &str) -> bool {
    matches!(code, "HARD" | "SOFT" | "IA" | "PILOTAGE" | "VIDEO")
}

fn check_assignments(a: &[AssignmentIn]) -> Result<(), &'static str> {
    if a.iter().any(|x| x.role != "lead" && x.role != "support") {
        return Err("bad-role");
    }
    if a.iter().any(|x| x.planned_hours < 0.0) {
        return Err("negative-hours");
    }
    let leads = a.iter().filter(|x| x.role == "lead").count();
    if !can_validate(leads) {
        return Err("need-exactly-one-lead");
    }
    Ok(())
}

pub async fn axes(State(s): State<AppState>) -> impl IntoResponse {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT code, label FROM axes ORDER BY code")
        .fetch_all(&s.pool)
        .await
        .unwrap_or_default();
    Json(rows.iter().map(|(c, l)| json!({"code": c, "label": l})).collect::<Vec<_>>())
}

pub async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(f): Query<TaskFilters>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let mut q = "SELECT id, title, axis_code, start_date, end_date, status, done_criteria, milestone FROM tasks WHERE 1=1".to_string();
    if f.axis.is_some() {
        q += " AND axis_code = $1";
    }
    if f.status.is_some() {
        q += if f.axis.is_some() { " AND status = $2" } else { " AND status = $1" };
    }
    q += " ORDER BY start_date";
    let mut query = sqlx::query_as::<_, (uuid::Uuid, String, String, NaiveDate, NaiveDate, String, String, bool)>(&q);
    if let Some(a) = f.axis {
        query = query.bind(a);
    }
    if let Some(st) = f.status {
        query = query.bind(st);
    }
    let rows = query.fetch_all(&s.pool).await.unwrap_or_default();
    let mut out = vec![];
    for (id, title, axis_code, start_date, end_date, status, done_criteria, milestone) in rows {
        out.push(task_out(&s.pool, id, title, axis_code, start_date, end_date, status, done_criteria, milestone).await);
    }
    (StatusCode::OK, Json(out)).into_response()
}

async fn task_out(
    pool: &sqlx::PgPool,
    id: uuid::Uuid,
    title: String,
    axis_code: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    status: String,
    done_criteria: String,
    milestone: bool,
) -> TaskOut {
    let assigns: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT user_id, role, planned_hours FROM assignments WHERE task_id = $1")
            .bind(id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    TaskOut {
        id,
        title,
        axis_code,
        start_date,
        end_date,
        status,
        done_criteria,
        milestone,
        assignments: assigns
            .into_iter()
            .map(|(user_id, role, planned_hours)| AssignmentOut { user_id, role, planned_hours })
            .collect(),
    }
}

pub async fn get(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let row: Option<(uuid::Uuid, String, String, NaiveDate, NaiveDate, String, String, bool)> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status, done_criteria, milestone FROM tasks WHERE id = $1")
            .bind(id)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    match row {
        Some((id, title, axis, sd, ed, st, crit, ms)) => {
            (StatusCode::OK, Json(task_out(&s.pool, id, title, axis, sd, ed, st, crit, ms).await))
                .into_response()
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response(),
    }
}

pub async fn create(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<TaskIn>,
) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if input.validate().is_err() || !valid_axis(&input.axis_code) || input.end_date < input.start_date {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    if let Err(e) = check_assignments(&input.assignments) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    // Validation active (défaut) : un membre ne publie pas, il propose (202 + révision).
    if role != "pilot" {
        let rev: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO task_revisions (task_id, payload, created_by)
             VALUES (NULL, $1, $2) RETURNING id",
        )
        .bind(serde_json::json!({
            "title": input.title, "axis_code": input.axis_code,
            "start_date": input.start_date, "end_date": input.end_date,
            "done_criteria": input.done_criteria, "milestone": input.milestone,
            "assignments": input.assignments.iter().map(|a| serde_json::json!({
                "user_id": a.user_id, "role": a.role, "planned_hours": a.planned_hours
            })).collect::<Vec<_>>(),
        }))
        .bind(uid)
        .fetch_one(&s.pool)
        .await
        .unwrap_or_else(|_| uuid::Uuid::nil());
        // ponytail: task_id factice — la vraie tâche naît à la validation (F11).
        let _ = rev;
        return (StatusCode::ACCEPTED, Json(json!({"status": "pending-validation"}))).into_response();
    }
    let milestone = input.milestone.unwrap_or(false);
    let rec: Option<uuid::Uuid> = sqlx::query_scalar(
        "INSERT INTO tasks (title, axis_code, start_date, end_date, done_criteria, milestone)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(input.title.trim())
    .bind(input.axis_code)
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.done_criteria.unwrap_or_default())
    .bind(milestone)
    .fetch_optional(&s.pool)
    .await
    .unwrap_or(None);
    let Some(id) = rec else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "insert-failed"}))).into_response();
    };
    for a in &input.assignments {
        let _ = sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(a.user_id)
        .bind(&a.role)
        .bind(a.planned_hours)
        .execute(&s.pool)
        .await;
    }
    (StatusCode::CREATED, Json(json!({"id": id}))).into_response()
}

pub async fn update(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(input): Json<TaskIn>,
) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if input.validate().is_err() || !valid_axis(&input.axis_code) || input.end_date < input.start_date {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "invalid-input"}))).into_response();
    }
    if let Err(e) = check_assignments(&input.assignments) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    // F11 : un membre ne modifie pas le publié — sa proposition attend la validation.
    if role != "pilot" {
        let _ = sqlx::query(
            "INSERT INTO task_revisions (task_id, payload, created_by) VALUES ($1, $2, $3)",
        )
        .bind(id)
        .bind(serde_json::json!({
            "title": input.title, "axis_code": input.axis_code,
            "start_date": input.start_date, "end_date": input.end_date,
            "done_criteria": input.done_criteria, "milestone": input.milestone,
            "assignments": input.assignments.iter().map(|a| serde_json::json!({
                "user_id": a.user_id, "role": a.role, "planned_hours": a.planned_hours
            })).collect::<Vec<_>>(),
        }))
        .bind(uid)
        .execute(&s.pool)
        .await;
        return (StatusCode::ACCEPTED, Json(json!({"status": "pending-validation"}))).into_response();
    }
    let old: Option<(NaiveDate, NaiveDate)> =
        sqlx::query_as("SELECT start_date, end_date FROM tasks WHERE id=$1")
            .bind(id)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    let Some((_, old_end)) = old else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    };
    let n = sqlx::query(
        "UPDATE tasks SET title=$1, axis_code=$2, start_date=$3, end_date=$4,
         done_criteria=$5, milestone=$6 WHERE id=$7",
    )
    .bind(input.title.trim())
    .bind(input.axis_code)
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.done_criteria.unwrap_or_default())
    .bind(input.milestone.unwrap_or(false))
    .bind(id)
    .execute(&s.pool)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if n == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    }
    let _ = sqlx::query("DELETE FROM assignments WHERE task_id=$1").bind(id).execute(&s.pool).await;
    for a in &input.assignments {
        let _ = sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(a.user_id)
        .bind(&a.role)
        .bind(a.planned_hours)
        .execute(&s.pool)
        .await;
    }
    // F2 : la fin recule → décalage en cascade (D13 : seulement si chevauchement,
    // jalons jamais bougés, sans repasser par la validation).
    let (shifted, threatened) = if input.end_date > old_end {
        super::deps::cascade_after_move(&s.pool, id, input.end_date).await
    } else {
        (vec![], vec![])
    };
    (StatusCode::OK, Json(json!({"ok": true, "shifted": shifted, "milestones_threatened": threatened}))).into_response()
}

pub async fn set_status(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(input): Json<StatusIn>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    if !matches!(input.status.as_str(), "todo" | "in_progress" | "blocked" | "done") {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-status"}))).into_response();
    }
    let n = sqlx::query("UPDATE tasks SET status=$1 WHERE id=$2")
        .bind(&input.status)
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
