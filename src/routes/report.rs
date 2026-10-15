use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::{
    load::{Allocation, planned_load},
    synthesis::{WeekFacts, synthesis_text},
    validation::pending_overdue,
    working_days::{project_week, today_paris, week_bounds},
};

#[derive(Deserialize)]
pub struct WeekQ {
    pub week: Option<i32>,
}


fn is_pilot(role: &str) -> bool {
    role == "pilot"
}

/// F10 : photo du lundi — fige dates + heures prévues comme référence du « prévu ».
/// La soutenance lit le prévu ici, jamais dans le planning courant.
pub async fn take_baseline(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<WeekQ>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if !is_pilot(&role) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let week = q.week.unwrap_or_else(|| project_week(today_paris()));
    match snapshot_week(&s.pool, week).await {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true, "week": week}))).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response(),
    }
}

/// Fige la semaine : baseline (dates + heures prévues) et sauvegarde JSON complète (D19).
/// Partagée par le bouton du pilote et la tâche de fond du lundi.
pub async fn snapshot_week(pool: &sqlx::PgPool, week: i32) -> Result<(), sqlx::Error> {
    type Row = (uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, bool);
    let tasks: Vec<Row> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status, milestone FROM tasks")
            .fetch_all(pool)
            .await?;
    let assigns: Vec<(uuid::Uuid, uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT task_id, user_id, role, planned_hours FROM assignments")
            .fetch_all(pool)
            .await?;
    let snap = json!({
        "week": week, "taken_at": chrono::Utc::now(),
        "tasks": tasks.iter().map(|(id, t, a, sd, ed, st, ms)| json!({
            "id": id, "title": t, "axis": a, "start": sd, "end": ed, "status": st, "milestone": ms,
            "assignments": assigns.iter().filter(|(tid, _, _, _)| tid == id)
                .map(|(_, u, r, h)| json!({"user_id": u, "role": r, "hours": h})).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    });
    sqlx::query(
        "INSERT INTO baselines (week, snapshot) VALUES ($1,$2)
         ON CONFLICT (week) DO UPDATE SET snapshot=EXCLUDED.snapshot, created_at=now()",
    )
    .bind(week)
    .bind(snap.clone())
    .execute(pool)
    .await?;
    // Sauvegarde JSON complète (D19 : en base, pas de S3 en V1).
    let full = json!({"baseline": snap, "exported_at": chrono::Utc::now()});
    sqlx::query(
        "INSERT INTO app_snapshots (week, payload) VALUES ($1,$2)
         ON CONFLICT (week) DO UPDATE SET payload=EXCLUDED.payload, created_at=now()",
    )
    .bind(week)
    .bind(full)
    .execute(pool)
    .await?;
    Ok(())
}

/// Tâche de fond (toutes les heures) : photo de la semaine dès qu'elle manque (en pratique le
/// lundi, ou au redémarrage si le serveur était arrêté), purge D20 des révisions décidées.
pub async fn housekeeping(pool: sqlx::PgPool) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
    loop {
        tick.tick().await;
        let week = project_week(today_paris());
        // Pas de photo d'un planning vide (premier déploiement avant l'import Asana).
        let missing: Result<bool, _> = sqlx::query_scalar(
            "SELECT NOT EXISTS (SELECT 1 FROM baselines WHERE week = $1) AND EXISTS (SELECT 1 FROM tasks)",
        )
        .bind(week)
        .fetch_one(&pool)
        .await;
        if let Ok(true) = missing {
            match snapshot_week(&pool, week).await {
                Ok(()) => tracing::info!("baseline S{week:02} prise automatiquement"),
                Err(e) => tracing::warn!("baseline S{week:02} : {e}"),
            }
        }
        // D20 : révisions validées ou rejetées, plus de 90 jours (date de proposition). Jamais les heures ni les baselines.
        if let Err(e) = sqlx::query(
            "DELETE FROM task_revisions WHERE status <> 'pending' AND created_at < now() - interval '90 days'",
        )
        .execute(&pool)
        .await
        {
            tracing::warn!("purge des révisions : {e}");
        }
    }
}

/// F10 : synthèse hebdo en texte à trous (D15 : pas d'IA, le pilote relit).
pub async fn synthesis(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<WeekQ>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if !is_pilot(&role) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let week = q.week.unwrap_or_else(|| project_week(today_paris()));
    let (wmon, wsun) = week_bounds(week);
    let alerts = super::stats::compute_alerts(&s.pool, uuid::Uuid::nil(), "pilot").await;
    let count = |k: &str| alerts.iter().filter(|a| a.get("kind").and_then(|v| v.as_str()) == Some(k)).count();
    let done_here: Vec<String> = sqlx::query_as::<_, (String,)>(
        "SELECT title FROM tasks WHERE status='done' AND end_date BETWEEN $1 AND $2",
    )
    .bind(wmon)
    .bind(wsun)
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(t,)| t)
    .collect();
    let pending: Vec<(chrono::NaiveDate,)> = sqlx::query_as(
        "SELECT (created_at AT TIME ZONE 'Europe/Paris')::date FROM task_revisions WHERE status='pending'",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let reminder = super::settings::load(&s.pool).await.reminder_days;
    let today = today_paris();
    let names = |kind: &str| -> Vec<String> {
        alerts
            .iter()
            .filter(|a| a.get("kind").and_then(|v| v.as_str()) == Some(kind))
            .filter_map(|a| a.get("title").and_then(|v| v.as_str()).map(|x| x.to_string()))
            .collect()
    };
    let real_hours: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(hours), 0) FROM time_entries WHERE week = $1")
        .bind(week)
        .fetch_one(&s.pool)
        .await
        .unwrap_or(0.0);
    let text = synthesis_text(&WeekFacts {
        week,
        monday: wmon,
        done: done_here,
        late: names("late"),
        overloads: count("overload"),
        overruns: count("overrun"),
        missing_hours: count("missing-hours"),
        threatened: count("milestone-threatened"),
        pending: pending.len(),
        pending_overdue: pending.iter().filter(|(d,)| pending_overdue(*d, today, reminder)).count(),
        real_hours,
    });
    (StatusCode::OK, Json(json!({"week": week, "text": text, "alerts": alerts}))).into_response()
}

/// F10 : export prévu (baseline de la semaine) contre réalisé (saisies), pour la soutenance.
pub async fn export(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<WeekQ>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if !is_pilot(&role) {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    let week = q.week.unwrap_or_else(|| project_week(today_paris()));
    let base: Option<(serde_json::Value, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT snapshot, created_at FROM baselines WHERE week=$1")
            .bind(week)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    // Réalisé et statut actuels par tâche (le prévu, lui, vient de la photo).
    let reals: Vec<(uuid::Uuid, String, f64)> = sqlx::query_as(
        "SELECT t.id, t.status, COALESCE(SUM(e.hours),0) FROM tasks t
         LEFT JOIN time_entries e ON e.task_id = t.id GROUP BY t.id, t.status",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let real_map: std::collections::HashMap<String, (String, f64)> =
        reals.into_iter().map(|(id, st, h)| (id.to_string(), (st, h))).collect();
    let persons: Vec<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, name FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    // Réalisé par personne : somme time_entries ; prévu : baseline de la semaine, en total et
    // « à date » (réparti au prorata des jours ouvrés jusqu'à la semaine, comme le plan de charge).
    let date = |t: &serde_json::Value, k: &str| t.get(k).and_then(|v| v.as_str()).and_then(|s| s.parse::<chrono::NaiveDate>().ok());
    let base_tasks: Vec<serde_json::Value> =
        base.as_ref().and_then(|(snap, _)| snap.get("tasks")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut persons_out = vec![];
    for (uid, name) in &persons {
        let mine: Vec<Allocation> = base_tasks
            .iter()
            .flat_map(|t| {
                let (s, e) = (date(t, "start"), date(t, "end"));
                t.get("assignments").and_then(|v| v.as_array()).cloned().unwrap_or_default().into_iter()
                    .filter(|a| a.get("user_id").and_then(|v| v.as_str()) == Some(&uid.to_string()))
                    .filter_map(move |a| Some(Allocation { task_start: s?, task_end: e?, hours: a.get("hours")?.as_f64()? }))
            })
            .collect();
        let planned_base: f64 = mine.iter().map(|a| a.hours).sum();
        let planned_to_date: f64 = (1..=week).map(|w| planned_load(&mine, w)).sum();
        let real: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1")
            .bind(uid)
            .fetch_one(&s.pool)
            .await
            .unwrap_or(0.0);
        persons_out.push(json!({"user_id": uid, "name": name,
            "planned_baseline": planned_base, "planned_to_date": planned_to_date, "real": real}));
    }
    (StatusCode::OK, Json(json!({
        "week": week,
        "baseline_taken_at": base.as_ref().map(|(_, at)| at),
        "tasks": base.as_ref().and_then(|(snap, _)| snap.get("tasks")).map(|ts| {
            ts.as_array().cloned().unwrap_or_default().iter().map(|t| {
                let id = t.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                json!({"id": id, "title": t.get("title"), "axis": t.get("axis"),
                    "planned": t.get("assignments").and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|x| x.get("hours").and_then(|v| v.as_f64())).sum::<f64>()).unwrap_or(0.0),
                    "real": real_map.get(&id).map(|(_, h)| *h).unwrap_or(0.0),
                    "status_at_baseline": t.get("status"),
                    "status_now": real_map.get(&id).map(|(st, _)| st.clone())})
            }).collect::<Vec<_>>()
        }),
        "persons": persons_out,
    }))).into_response()
}
