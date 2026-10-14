use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};

use super::{AppState, current_user};
use crate::domain::{
    cpm::critical_path,
    working_days::today_paris,
};

#[derive(Deserialize)]
pub struct GanttQ {
    pub axis: Option<String>,
}


async fn graph(pool: &sqlx::PgPool)
    -> (Vec<(uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, bool)>,
        Vec<(uuid::Uuid, uuid::Uuid)>, HashSet<String>)
{
    let tasks: Vec<(uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, bool)> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status, milestone FROM tasks ORDER BY start_date")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let deps: Vec<(uuid::Uuid, uuid::Uuid)> =
        sqlx::query_as("SELECT pred_id, succ_id FROM dependencies")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let ids: Vec<String> = tasks.iter().map(|(i, _, _, _, _, _, _)| i.to_string()).collect();
    let start: HashMap<String, chrono::NaiveDate> =
        tasks.iter().map(|(i, _, _, s, _, _, _)| (i.to_string(), *s)).collect();
    let end: HashMap<String, chrono::NaiveDate> =
        tasks.iter().map(|(i, _, _, _, e, _, _)| (i.to_string(), *e)).collect();
    let dstr: Vec<(String, String)> = deps.iter().map(|(p, q)| (p.to_string(), q.to_string())).collect();
    let (_, critical) = critical_path(&ids, &start, &end, &dstr);
    (tasks, deps, critical.into_iter().collect())
}

/// F8 : Gantt — tâches (+ jalons), dépendances, chemin critique, ligne d'aujourd'hui.
/// Le déplacement des barres passe par PUT /api/tasks/:id (pilote, F2 décale en cascade).
pub async fn gantt(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<GanttQ>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let (tasks, deps, crit) = graph(&s.pool).await;
    let items: Vec<_> = tasks
        .iter()
        .filter(|(_, _, a, _, _, _, _)| q.axis.as_ref().is_none_or(|x| x == a))
        .map(|(id, title, axis, sd, ed, st, ms)| {
            json!({"id": id, "title": title, "axis": axis, "start": sd, "end": ed,
                "status": st, "milestone": ms, "critical": crit.contains(&id.to_string())})
        })
        .collect();
    let links: Vec<_> = deps
        .iter()
        .map(|(p, q)| json!({"from": p, "to": q}))
        .collect();
    (StatusCode::OK, Json(json!({"today": today_paris(), "tasks": items, "deps": links}))).into_response()
}

/// F9 : météo par axe — avancement, retards, prochain jalon et son risque.
pub async fn meteo(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let today = today_paris();
    let (tasks, deps, _) = graph(&s.pool).await;
    let axes: Vec<(String, String)> =
        sqlx::query_as("SELECT code, label FROM axes ORDER BY code")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let mut cards = vec![];
    for (code, label) in axes {
        let mine: Vec<_> = tasks.iter().filter(|(_, _, a, _, _, _, _)| a == &code).collect();
        let total = mine.len();
        let done = mine.iter().filter(|(_, _, _, _, _, st, _)| st == "done").count();
        let late: Vec<_> = mine
            .iter()
            .filter(|(_, _, _, _, e, st, ms)| !ms && st != "done" && e < &today)
            .map(|(id, t, _, _, e, _, _)| json!({"id": id, "title": t, "end": e}))
            .collect();
        // Prochain jalon de l'axe : le plus tôt non terminé.
        let mut milestones: Vec<_> = mine.iter().filter(|(_, _, _, _, _, st, ms)| *ms && st != "done").collect();
        milestones.sort_by_key(|(_, _, _, _, e, _, _)| *e);
        let next = milestones.first().map(|(mid, mtitle, _, _, me, _, _)| {
            // Risque : prédécesseur non terminé qui finit le jour du jalon ou après.
            let mut risk: Option<String> = None;
            for (p, q) in &deps {
                if q == mid {
                    if let Some((_, pt, _, _, pe, pst, _)) =
                        tasks.iter().find(|(i, _, _, _, _, _, _)| i == p)
                    {
                        if pst != "done" && pe >= me {
                            risk = Some(format!("menacé par « {pt} »"));
                            break;
                        }
                    }
                }
            }
            json!({"id": mid, "title": mtitle, "date": me, "risk": risk})
        });
        cards.push(json!({"axis": code, "label": label, "total": total, "done": done,
            "progress": if total == 0 { 1.0 } else { done as f64 / total as f64 },
            "late": late, "next_milestone": next}));
    }
    (StatusCode::OK, Json(json!({"cards": cards}))).into_response()
}
