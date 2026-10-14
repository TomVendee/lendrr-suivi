use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::{
    load::{Allocation, planned_load},
    working_days::{project_week, week_bounds},
};

#[derive(Deserialize)]
pub struct WeekQ {
    pub week: Option<i32>,
}

#[derive(Serialize)]
pub struct MyWeekTask {
    pub id: uuid::Uuid,
    pub title: String,
    pub axis_code: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub status: String,
    pub done_criteria: String,
    pub my_role: String,
    pub my_planned_hours: f64,
    pub my_real_hours: f64,
}

fn today_paris() -> NaiveDate {
    chrono::Utc::now()
        .with_timezone(&chrono_tz::Europe::Paris)
        .date_naive()
}

/// F3 : ma semaine — mes tâches qui chevauchent la semaine + charge + alertes perso.
/// F5 s'appuie dessus pour la saisie (< 1 min : un POST par tâche).
pub async fn my_week(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<WeekQ>,
) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let week = q.week.unwrap_or_else(|| project_week(today_paris()));
    let (wmon, wsun) = week_bounds(week);

    let rows: Vec<(uuid::Uuid, String, String, NaiveDate, NaiveDate, String, String, String, f64)> = sqlx::query_as(
        "SELECT t.id, t.title, t.axis_code, t.start_date, t.end_date, t.status, t.done_criteria, a.role, a.planned_hours
         FROM tasks t JOIN assignments a ON a.task_id = t.id
         WHERE a.user_id = $1 AND t.start_date <= $2 AND t.end_date >= $3
         ORDER BY t.start_date",
    )
    .bind(uid)
    .bind(wsun)
    .bind(wmon)
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();

    let mut tasks = vec![];
    let mut allocs = vec![];
    for (id, title, axis, sd, ed, st, crit, role, hours) in &rows {
        let real: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE task_id=$1 AND user_id=$2 AND week=$3",
        )
        .bind(id)
        .bind(uid)
        .bind(week)
        .fetch_one(&s.pool)
        .await
        .unwrap_or(0.0);
        allocs.push(Allocation { task_start: *sd, task_end: *ed, hours: *hours });
        tasks.push(MyWeekTask {
            id: *id,
            title: title.clone(),
            axis_code: axis.clone(),
            start_date: *sd,
            end_date: *ed,
            status: st.clone(),
            done_criteria: crit.clone(),
            my_role: role.clone(),
            my_planned_hours: *hours,
            my_real_hours: real,
        });
    }
    let planned = planned_load(&allocs, week);
    let real: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1 AND week=$2",
    )
    .bind(uid)
    .bind(week)
    .fetch_one(&s.pool)
    .await
    .unwrap_or(0.0);
    let capacity: f64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT hours FROM capacity_overrides WHERE user_id=$1 AND week=$2),
                         (SELECT default_capacity_hours FROM users WHERE id=$1))",
    )
    .bind(uid)
    .bind(week)
    .fetch_one(&s.pool)
    .await
    .unwrap_or(4.0);

    // Alertes perso minimales (moteur complet en F7) : surcharge, heures manquantes, mes retards.
    let mut alerts = vec![];
    if planned > capacity {
        alerts.push(json!({"kind": "overload", "week": week, "planned": planned, "capacity": capacity}));
    }
    if week < project_week(today_paris()) && real == 0.0 {
        alerts.push(json!({"kind": "missing-hours", "week": week}));
    }
    let late: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT t.id, t.title FROM tasks t JOIN assignments a ON a.task_id=t.id
         WHERE a.user_id=$1 AND a.role='lead' AND t.end_date < $2 AND t.status <> 'done'",
    )
    .bind(uid)
    .bind(today_paris())
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    for (id, title) in late {
        alerts.push(json!({"kind": "late", "task_id": id, "title": title}));
    }

    (
        StatusCode::OK,
        Json(json!({
            "week": week, "monday": wmon, "sunday": wsun,
            "tasks": tasks,
            "planned": planned, "real": real, "capacity": capacity,
            "alerts": alerts,
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub struct LogIn {
    pub task_id: uuid::Uuid,
    pub week: i32,
    pub hours: f64,
}

/// F5 : « 1,5 h sur cette tâche ». Upsert : re-poster corrige la saisie.
pub async fn log_hours(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<LogIn>,
) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if !(0.0..=80.0).contains(&input.hours) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-hours"}))).into_response();
    }
    let assigned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM assignments WHERE task_id=$1 AND user_id=$2)",
    )
    .bind(input.task_id)
    .bind(uid)
    .fetch_one(&s.pool)
    .await
    .unwrap_or(false);
    if !assigned && role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "not-assigned"}))).into_response();
    }
    let r = sqlx::query(
        "INSERT INTO time_entries (task_id, user_id, week, hours) VALUES ($1,$2,$3,$4)
         ON CONFLICT (task_id, user_id, week) DO UPDATE SET hours = EXCLUDED.hours",
    )
    .bind(input.task_id)
    .bind(uid)
    .bind(input.week)
    .bind(input.hours)
    .execute(&s.pool)
    .await;
    match r {
        Ok(_) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err(_) => (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-task"}))).into_response(),
    }
}
