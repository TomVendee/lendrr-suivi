use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::{Value, json};
use chrono::{Datelike, Timelike};
use std::collections::{HashMap, HashSet};

use super::{AppState, current_user};
use crate::domain::{
    alerts::{Thresholds, overrun},
    cpm::critical_path,
    load::{Allocation, planned_load},
    working_days::project_week,
};

#[derive(Deserialize)]
pub struct LoadQ {
    pub from: Option<i32>,
    pub to: Option<i32>,
}

fn today_paris() -> chrono::NaiveDate {
    chrono::Utc::now()
        .with_timezone(&chrono_tz::Europe::Paris)
        .date_naive()
}

/// F6 : plan de charge personne × semaine (prévu, réel, capacité).
/// Visible par tous (cahier) ; calculé à la lecture, pas de temps réel en V1 (D14).
pub async fn load(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<LoadQ>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let cur = project_week(today_paris());
    let from = q.from.unwrap_or(cur.saturating_sub(2)).max(1);
    let to = q.to.unwrap_or(cur + 6).max(from);

    let users: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT id, name, default_capacity_hours FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let assigns: Vec<(uuid::Uuid, chrono::NaiveDate, chrono::NaiveDate, f64)> = sqlx::query_as(
        "SELECT a.user_id, t.start_date, t.end_date, a.planned_hours
         FROM assignments a JOIN tasks t ON t.id = a.task_id",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let reals: Vec<(uuid::Uuid, i32, f64)> = sqlx::query_as(
        "SELECT user_id, week, COALESCE(SUM(hours),0) FROM time_entries GROUP BY user_id, week",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let real_map: HashMap<(uuid::Uuid, i32), f64> =
        reals.into_iter().map(|(u, w, h)| ((u, w), h)).collect();
    let caps: Vec<(uuid::Uuid, i32, f64)> =
        sqlx::query_as("SELECT user_id, week, hours FROM capacity_overrides")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let cap_map: HashMap<(uuid::Uuid, i32), f64> =
        caps.into_iter().map(|(u, w, h)| ((u, w), h)).collect();

    let mut rows = vec![];
    for (uid, name, defcap) in &users {
        let my: Vec<Allocation> = assigns
            .iter()
            .filter(|(u, _, _, _)| u == uid)
            .map(|(_, s, e, h)| Allocation { task_start: *s, task_end: *e, hours: *h })
            .collect();
        let mut weeks = vec![];
        for w in from..=to {
            weeks.push(json!({
                "week": w,
                "planned": planned_load(&my, w),
                "real": real_map.get(&(*uid, w)).copied().unwrap_or(0.0),
                "capacity": cap_map.get(&(*uid, w)).copied().unwrap_or(*defcap),
            }));
        }
        rows.push(json!({"user_id": uid, "name": name, "weeks": weeks}));
    }
    (StatusCode::OK, Json(json!({"from": from, "to": to, "rows": rows}))).into_response()
}

/// F7 : les 7 alertes du cahier, triées par gravité.
/// Membre : les siennes (+ jalons menacés, équipe entière). Pilote : toutes.
pub async fn alerts(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let today = today_paris();
    let cur = project_week(today);
    let t = Thresholds::default();
    let mut out: Vec<Value> = vec![];

    let users: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT id, name, default_capacity_hours FROM users")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let name_of = |id: &uuid::Uuid| {
        users.iter().find(|(u, _, _)| u == id).map(|(_, n, _)| n.clone()).unwrap_or_default()
    };

    // Données tâches + assignations.
    let tasks: Vec<(uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, bool)> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status, milestone FROM tasks")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let assigns: Vec<(uuid::Uuid, uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT task_id, user_id, role, planned_hours FROM assignments")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let dep_rows: Vec<(uuid::Uuid, uuid::Uuid)> =
        sqlx::query_as("SELECT pred_id, succ_id FROM dependencies")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();

    // 1. Surcharge prévue (semaines à venir) + 3. Heures non déclarées (semaine écoulée).
    for (id, _, defcap) in &users {
        if role != "pilot" && id != &uid {
            continue;
        }
        let my: Vec<Allocation> = assigns
            .iter()
            .filter(|(_, u, _, _)| u == id)
            .map(|(tid, _, _, h)| {
                let t = tasks.iter().find(|(i, _, _, _, _, _, _)| i == tid).unwrap();
                Allocation { task_start: t.3, task_end: t.4, hours: *h }
            })
            .collect();
        for w in cur..=(cur + 6) {
            let cap: f64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT hours FROM capacity_overrides WHERE user_id=$1 AND week=$2), $3)",
            )
            .bind(id)
            .bind(w)
            .bind(*defcap)
            .fetch_one(&s.pool)
            .await
            .unwrap_or(*defcap);
            if planned_load(&my, w) > cap {
                out.push(json!({"kind": "overload", "severity": 2, "user_id": id,
                    "user": name_of(id), "week": w,
                    "planned": planned_load(&my, w), "capacity": cap}));
            }
        }
        let last_real: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1 AND week=$2",
        )
        .bind(id)
        .bind(cur - 1)
        .fetch_one(&s.pool)
        .await
        .unwrap_or(0.0);
        // Lundi 12h Paris, semaine écoulée sans saisie (V1 : évalué à la lecture).
        if cur > 1 && last_real == 0.0 {
            let now = chrono::Utc::now().with_timezone(&chrono_tz::Europe::Paris);
            let is_monday = now.date_naive() == today && today.weekday().number_from_monday() == 1;
            if !is_monday || now.hour() >= 12 {
                out.push(json!({"kind": "missing-hours", "severity": 1, "user_id": id,
                    "user": name_of(id), "week": cur - 1}));
            }
        }
    }

    // 2. Dépassement réel par (tâche, personne).
    let totals: Vec<(uuid::Uuid, uuid::Uuid, f64)> = sqlx::query_as(
        "SELECT task_id, user_id, COALESCE(SUM(hours),0) FROM time_entries GROUP BY task_id, user_id",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    for (tid, who, real) in totals {
        if role != "pilot" && who != uid {
            continue;
        }
        let planned: f64 = assigns.iter().filter(|(t, u, _, _)| *t == tid && *u == who).map(|(_, _, _, h)| h).sum();
        if overrun(planned, real, &t) {
            let title = tasks.iter().find(|(i, _, _, _, _, _, _)| *i == tid).map(|(_, x, _, _, _, _, _)| x.clone()).unwrap_or_default();
            out.push(json!({"kind": "overrun", "severity": 2, "task_id": tid, "title": title,
                "user_id": who, "user": name_of(&who), "planned": planned, "real": real}));
        }
    }

    // 4. Tâches en retard + 5. Retards bloquants + 6. Jalons menacés (via chemin critique).
    let ids: Vec<String> = tasks.iter().map(|(i, _, _, _, _, _, _)| i.to_string()).collect();
    let start: HashMap<String, chrono::NaiveDate> =
        tasks.iter().map(|(i, _, _, s, _, _, _)| (i.to_string(), *s)).collect();
    let end: HashMap<String, chrono::NaiveDate> =
        tasks.iter().map(|(i, _, _, _, e, _, _)| (i.to_string(), *e)).collect();
    let deps: Vec<(String, String)> =
        dep_rows.iter().map(|(p, q)| (p.to_string(), q.to_string())).collect();
    let (_, critical) = critical_path(&ids, &start, &end, &deps);
    let crit: HashSet<String> = critical.into_iter().collect();
    let succ_of = |id: &uuid::Uuid| {
        dep_rows.iter().filter(|(p, _)| p == id).map(|(_, q)| *q).collect::<Vec<_>>()
    };
    let task_of = |id: &uuid::Uuid| tasks.iter().find(|(i, _, _, _, _, _, _)| i == id);

    for (id, title, _, _, e, st, ms) in &tasks {
        if *ms || st == "done" || *e >= today {
            continue;
        }
        // En retard : pilote de la tâche + pilote projet.
        let lead = assigns.iter().find(|(t, _, r, _)| t == id && r == "lead").map(|(_, u, _, _)| *u);
        let visible = role == "pilot" || lead == Some(uid);
        if !visible {
            continue;
        }
        out.push(json!({"kind": "late", "severity": 3, "task_id": id, "title": title,
            "lead": lead, "lead_name": lead.map(|l| name_of(&l))}));
        // Bloquant : un successeur commence dans < 7 jours.
        for q in succ_of(id) {
            if let Some((_, _, _, _, qs, qst, _)) = task_of(&q) {
                if qst != "done" && (*qs - today).num_days() < 7 {
                    let qlead = assigns.iter().find(|(t, _, r, _)| t == &q && r == "lead").map(|(_, u, _, _)| *u);
                    let qtitle = task_of(&q).map(|(_, x, _, _, _, _, _)| x.clone()).unwrap_or_default();
                    out.push(json!({"kind": "blocking-late", "severity": 3, "task_id": id, "title": title,
                        "succ_id": q, "succ_title": qtitle, "succ_lead": qlead}));
                }
            }
        }
        // Jalon menacé : tâche critique en retard → toute l'équipe.
        if crit.contains(&id.to_string()) {
            out.push(json!({"kind": "milestone-threatened", "severity": 3,
                "task_id": id, "title": title, "reason": "critical-late"}));
        }
    }
    // Marge vers jalon négative : un prédécesseur non terminé finit après le jalon.
    for (mid, mtitle, _, _, me, mst, ms) in &tasks {
        if !ms || mst == "done" {
            continue;
        }
        let preds: Vec<uuid::Uuid> =
            dep_rows.iter().filter(|(_, q)| q == mid).map(|(p, _)| *p).collect();
        for p in preds {
            if let Some((_, ptitle, _, _, pe, pst, _)) = task_of(&p) {
                if pst != "done" && *pe >= *me {
                    out.push(json!({"kind": "milestone-threatened", "severity": 3,
                        "milestone_id": mid, "milestone": mtitle,
                        "reason": "negative-margin", "task_title": ptitle}));
                    break;
                }
            }
        }
    }

    // 7. Tâches incomplètes (pas de pilote / pas d'heures) : pilote projet.
    if role == "pilot" {
        for (id, title, _, _, _, _, _) in &tasks {
            let leads = assigns.iter().filter(|(t, _, r, _)| t == id && r == "lead").count();
            let hours: f64 = assigns.iter().filter(|(t, _, _, _)| t == id).map(|(_, _, _, h)| h).sum();
            if leads != 1 || hours <= 0.0 {
                out.push(json!({"kind": "incomplete", "severity": 1, "task_id": id, "title": title}));
            }
        }
    }

    out.sort_by_key(|a| std::cmp::Reverse(a.get("severity").and_then(|v| v.as_u64()).unwrap_or(0)));
    (StatusCode::OK, Json(json!({"alerts": out}))).into_response()
}
