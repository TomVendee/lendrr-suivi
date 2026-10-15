use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user};
use crate::domain::working_days::{project_week, today_paris, week_bounds};

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
        let has: Result<bool, _> = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM baselines WHERE week = $1)")
            .bind(week)
            .fetch_one(&pool)
            .await;
        if let Ok(false) = has {
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
    let pending: Vec<(chrono::DateTime<chrono::Utc>,)> = sqlx::query_as(
        "SELECT created_at FROM task_revisions WHERE status='pending'",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let old = pending.iter().filter(|(at,)| (*at + chrono::Duration::days(2)) < chrono::Utc::now()).count();
    let late_titles: Vec<String> = alerts
        .iter()
        .filter(|a| a.get("kind").and_then(|v| v.as_str()) == Some("late"))
        .filter_map(|a| a.get("title").and_then(|v| v.as_str()).map(|x| x.to_string()))
        .collect();
    let text = format!(
        "Semaine S{week:02} ({} → {}). {} tâche(s) terminée(s) : {}. \
         En retard : {}. Surcharge(s) prévue(s) : {}. Dépassement(s) réel(s) : {}. \
         Heures non déclarées : {}. Jalon(s) menacé(s) : {}. \
         En attente de validation : {} (dont {} depuis plus de 2 jours). \
         [À relire et compléter par le pilote]",
        wmon.format("%d/%m"),
        wsun.format("%d/%m"),
        done_here.len(),
        if done_here.is_empty() { "aucune".into() } else { done_here.join(", ") },
        if late_titles.is_empty() { "aucune".into() } else { late_titles.join(", ") },
        count("overload"),
        count("overrun"),
        count("missing-hours"),
        count("milestone-threatened"),
        pending.len(),
        old,
    );
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
    let reals: Vec<(uuid::Uuid, String, f64)> = sqlx::query_as(
        "SELECT t.id, t.title, COALESCE(SUM(e.hours),0) FROM tasks t
         LEFT JOIN time_entries e ON e.task_id = t.id GROUP BY t.id, t.title",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let real_map: std::collections::HashMap<String, f64> =
        reals.into_iter().map(|(id, _, h)| (id.to_string(), h)).collect();
    let persons: Vec<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, name FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    // Réalisé par personne : somme time_entries ; prévu : baseline de la semaine.
    let mut persons_out = vec![];
    for (uid, name) in &persons {
        let planned_base: f64 = base
            .as_ref()
            .and_then(|(snap, _)| snap.get("tasks"))
            .and_then(|v| v.as_array())
            .map(|ts| {
                ts.iter()
                    .flat_map(|t| t.get("assignments").and_then(|v| v.as_array()).cloned().unwrap_or_default())
                    .filter(|a| a.get("user_id").and_then(|v| v.as_str()) == Some(&uid.to_string()))
                    .filter_map(|a| a.get("hours").and_then(|v| v.as_f64()))
                    .sum()
            })
            .unwrap_or(0.0);
        let real: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1")
            .bind(uid)
            .fetch_one(&s.pool)
            .await
            .unwrap_or(0.0);
        persons_out.push(json!({"user_id": uid, "name": name,
            "planned_baseline": planned_base, "real": real}));
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
                    "real": real_map.get(&id).copied().unwrap_or(0.0),
                    "status_now": t.get("status")})
            }).collect::<Vec<_>>()
        }),
        "persons": persons_out,
    }))).into_response()
}
