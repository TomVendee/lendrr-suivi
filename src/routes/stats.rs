use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

use super::{AppState, current_user};
use crate::domain::{
    alerts::{blocking, incomplete, late, milestone_at_risk, missing_hours_due, overloaded, overrun},
    cpm::critical_path,
    load::{Allocation, planned_load},
    validation::pending_overdue,
    working_days::{project_week, today_paris},
};

#[derive(Deserialize)]
pub struct LoadQ {
    pub from: Option<i32>,
    pub to: Option<i32>,
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
    (StatusCode::OK, Json(json!({"from": from, "to": to, "current": cur, "rows": rows}))).into_response()
}

/// F7 : les 7 alertes du cahier, triées par gravité.
/// Membre : les siennes (+ jalons menacés, équipe entière). Pilote : toutes.
pub async fn alerts(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    let out = compute_alerts(&s.pool, uid, &role).await;
    (StatusCode::OK, Json(json!({"alerts": out}))).into_response()
}

/// Cœur pur-I/O du moteur d'alertes, réutilisé par la REST et le MCP.
pub async fn compute_alerts(pool: &sqlx::PgPool, uid: uuid::Uuid, role: &str) -> Vec<Value> {
    let today = today_paris();
    let cur = project_week(today);
    let st = super::settings::load(pool).await;
    let t = st.thresholds();
    let mut out: Vec<Value> = vec![];

    let users: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT id, name, default_capacity_hours FROM users")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let name_of = |id: &uuid::Uuid| {
        users.iter().find(|(u, _, _)| u == id).map(|(_, n, _)| n.clone()).unwrap_or_default()
    };

    // Données tâches + assignations.
    let tasks: Vec<(uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, bool)> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status, milestone FROM tasks")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let assigns: Vec<(uuid::Uuid, uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT task_id, user_id, role, planned_hours FROM assignments")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let dep_rows: Vec<(uuid::Uuid, uuid::Uuid)> =
        sqlx::query_as("SELECT pred_id, succ_id FROM dependencies")
            .fetch_all(pool)
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
            .filter_map(|(tid, _, _, h)| {
                tasks
                    .iter()
                    .find(|(i, _, _, _, _, _, _)| i == tid)
                    .map(|t| Allocation { task_start: t.3, task_end: t.4, hours: *h })
            })
            .collect();
        for w in cur..=(cur + 6) {
            let cap: f64 = sqlx::query_scalar(
                "SELECT COALESCE((SELECT hours FROM capacity_overrides WHERE user_id=$1 AND week=$2), $3)",
            )
            .bind(id)
            .bind(w)
            .bind(*defcap)
            .fetch_one(pool)
            .await
            .unwrap_or(*defcap);
            if overloaded(planned_load(&my, w), cap) {
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
        .fetch_one(pool)
        .await
        .unwrap_or(0.0);
        // Lundi 12 h Paris, semaine écoulée sans saisie (évalué à la lecture).
        let now = chrono::Utc::now().with_timezone(&chrono_tz::Europe::Paris).naive_local();
        if cur > 1 && last_real == 0.0 && missing_hours_due(now) {
            out.push(json!({"kind": "missing-hours", "severity": 1, "user_id": id,
                "user": name_of(id), "week": cur - 1}));
        }
    }

    // 2. Dépassement réel par (tâche, personne).
    let totals: Vec<(uuid::Uuid, uuid::Uuid, f64)> = sqlx::query_as(
        "SELECT task_id, user_id, COALESCE(SUM(hours),0) FROM time_entries GROUP BY task_id, user_id",
    )
    .fetch_all(pool)
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

    let lead_of = |id: &uuid::Uuid| assigns.iter().find(|(t, _, r, _)| t == id && r == "lead").map(|(_, u, _, _)| *u);
    for (id, title, _, _, e, st, ms) in &tasks {
        if !late(*e, st == "done", *ms, today) {
            continue;
        }
        let lead = lead_of(id);
        // Jalon menacé : tâche critique en retard → toute l'équipe.
        if crit.contains(&id.to_string()) {
            out.push(json!({"kind": "milestone-threatened", "severity": 3,
                "task_id": id, "title": title, "reason": "critical-late"}));
        }
        // En retard : pilote de la tâche + pilote projet.
        if role == "pilot" || lead == Some(uid) {
            out.push(json!({"kind": "late", "severity": 3, "task_id": id, "title": title,
                "lead": lead, "lead_name": lead.map(|l| name_of(&l))}));
        }
        // Bloquant : les deux pilotes concernés + pilote projet.
        for q in succ_of(id) {
            // (id, titre, axe, début, fin, statut, jalon) : le successeur bloqué compte à partir de son début.
            if let Some((_, _, _, qs, _, qst, _)) = task_of(&q) {
                let qlead = lead_of(&q);
                let mine = role == "pilot" || lead == Some(uid) || qlead == Some(uid);
                if mine && blocking(*qs, qst == "done", today, &t) {
                    let qtitle = task_of(&q).map(|(_, x, _, _, _, _, _)| x.clone()).unwrap_or_default();
                    out.push(json!({"kind": "blocking-late", "severity": 3, "task_id": id, "title": title,
                        "succ_id": q, "succ_title": qtitle, "succ_lead": qlead}));
                }
            }
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
                if milestone_at_risk(*pe, pst == "done", *me) {
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
            if incomplete(leads, hours) {
                out.push(json!({"kind": "incomplete", "severity": 1, "task_id": id, "title": title}));
            }
        }
    }

    // 8. Rappel de validation (réglage `reminder_days`) : pour qui peut valider. Pas de notification (Hors V1).
    if st.can_decide(uid, role) {
        let pending: Vec<(uuid::Uuid, Option<uuid::Uuid>, Option<String>, chrono::NaiveDate)> = sqlx::query_as(
            "SELECT id, task_id, payload->>'title', (created_at AT TIME ZONE 'Europe/Paris')::date
             FROM task_revisions WHERE status = 'pending'",
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (rid, tid, title, created) in pending {
            if pending_overdue(created, today, st.reminder_days) {
                out.push(json!({"kind": "validation-pending", "severity": 1, "revision_id": rid,
                    "task_id": tid, "title": title, "since": created}));
            }
        }
    }

    out.sort_by_key(|a| std::cmp::Reverse(a.get("severity").and_then(|v| v.as_u64()).unwrap_or(0)));
    out
}

/// Capacités et absences par personne et par semaine (cahier : 4 h par défaut,
/// 0 h en absence). Lecture : connecté. Écriture : pilote (upsert, 0 h = absence).
pub async fn capacities(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let users: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT id, name, default_capacity_hours FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let overs: Vec<(uuid::Uuid, i32, f64)> =
        sqlx::query_as("SELECT user_id, week, hours FROM capacity_overrides")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let out: Vec<_> = users
        .iter()
        .map(|(id, name, def)| {
            let o: Vec<_> = overs
                .iter()
                .filter(|(u, _, _)| u == id)
                .map(|(_, w, h)| json!({"week": w, "hours": h}))
                .collect();
            json!({"user_id": id, "name": name, "default": def, "overrides": o})
        })
        .collect();
    (StatusCode::OK, Json(out)).into_response()
}

#[derive(Deserialize)]
pub struct CapacityIn {
    pub user_id: uuid::Uuid,
    pub week: i32,
    pub hours: f64,
}

pub async fn set_capacity(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CapacityIn>,
) -> impl IntoResponse {
    let Ok((_, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    if role != "pilot" {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "pilot-only"}))).into_response();
    }
    if !(0.0..=80.0).contains(&input.hours) || input.week < 1 {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-capacity"}))).into_response();
    }
    let _ = sqlx::query(
        "INSERT INTO capacity_overrides (user_id, week, hours) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, week) DO UPDATE SET hours = EXCLUDED.hours",
    )
    .bind(input.user_id)
    .bind(input.week)
    .bind(input.hours)
    .execute(&s.pool)
    .await;
    (StatusCode::OK, Json(json!({"ok": true}))).into_response()
}

/// Écran Graphes : cumul prévu/déclaré, barres par semaine, par personne, avancement par axe.
pub async fn graphs(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let cur = project_week(today_paris());
    let from = 1;
    let to = cur + 6;

    let tasks: Vec<(uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String)> =
        sqlx::query_as("SELECT id, title, axis_code, start_date, end_date, status FROM tasks")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();
    let assigns: Vec<(uuid::Uuid, uuid::Uuid, f64, chrono::NaiveDate, chrono::NaiveDate)> = sqlx::query_as(
        "SELECT a.user_id, a.task_id, a.planned_hours, t.start_date, t.end_date
         FROM assignments a JOIN tasks t ON t.id = a.task_id",
    )
    .fetch_all(&s.pool)
    .await
    .unwrap_or_default();
    let users: Vec<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, name FROM users ORDER BY name")
            .fetch_all(&s.pool)
            .await
            .unwrap_or_default();

    let mut weeks = vec![];
    let (mut cum_p, mut cum_r) = (0.0, 0.0);
    // Même prorata qu'en F3/F6 : heures réparties au prorata des jours ouvrés.
    let allocs: Vec<Allocation> = assigns
        .iter()
        .map(|(_, _, h, s, e)| Allocation { task_start: *s, task_end: *e, hours: *h })
        .collect();
    for w in from..=to {
        let p: f64 = allocs.iter().map(|a| crate::domain::load::hours_in_week(a, w)).sum();
        let r: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE week=$1")
            .bind(w)
            .fetch_one(&s.pool)
            .await
            .unwrap_or(0.0);
        cum_p += p;
        cum_r += r;
        weeks.push(json!({"week": w, "planned": p, "real": r, "cum_planned": cum_p, "cum_real": cum_r}));
    }
    let mut persons = vec![];
    for (uid, name) in &users {
        let r: f64 = sqlx::query_scalar("SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1")
            .bind(uid)
            .fetch_one(&s.pool)
            .await
            .unwrap_or(0.0);
        persons.push(json!({"user_id": uid, "name": name, "real": r}));
    }
    let axes = ["HARD", "SOFT", "IA", "PILOTAGE", "VIDEO"];
    let by_axis: Vec<_> = axes
        .iter()
        .map(|a| {
            let mine: Vec<_> = tasks.iter().filter(|(_, _, x, _, _, _)| x == a).collect();
            let done = mine.iter().filter(|(_, _, _, _, _, st)| st == "done").count();
            json!({"axis": a, "done": done, "total": mine.len()})
        })
        .collect();
    let done_total = tasks.iter().filter(|(_, _, _, _, _, st)| st == "done").count();
    (
        StatusCode::OK,
        Json(json!({"from": from, "to": to, "current": cur, "weeks": weeks,
            "persons": persons, "axes": by_axis,
            "tasks_done": done_total, "tasks_total": tasks.len()})),
    )
        .into_response()
}
