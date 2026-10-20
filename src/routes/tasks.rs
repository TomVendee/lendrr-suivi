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
use crate::domain::validation::{WriteMode, can_validate, valid_axis, write_mode};

/// Colonnes publiées d'une tâche (champs nommés : pas d'erreur de position dans un tuple).
#[derive(sqlx::FromRow)]
struct TaskRow {
    id: uuid::Uuid,
    title: String,
    axis_code: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
    status: String,
    done_criteria: String,
    description: String,
    milestone: bool,
}
const TASK_COLS: &str = "id, title, axis_code, start_date, end_date, status, done_criteria, description, milestone";

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
    pub description: String,
    pub milestone: bool,
    pub assignments: Vec<AssignmentOut>,
    pub depends_on: Vec<DepOut>,
}

#[derive(Serialize)]
pub struct DepOut {
    pub id: uuid::Uuid,
    pub title: String,
}

#[derive(Deserialize)]
pub struct TaskFilters {
    pub axis: Option<String>,
    pub status: Option<String>,
    /// Recherche plein texte sur le titre (ILIKE %..%).
    pub q: Option<String>,
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
    #[validate(length(max = 10000))]
    pub description: Option<String>,
    pub milestone: Option<bool>,
    pub assignments: Vec<AssignmentIn>,
}

#[derive(Deserialize)]
pub struct StatusIn {
    pub status: String,
}

#[derive(Deserialize)]
pub struct CommentIn {
    pub body: String,
}

/// Fil de discussion d'une tâche, du plus ancien au plus récent (REST et MCP).
pub async fn comment_list(pool: &sqlx::PgPool, task_id: uuid::Uuid) -> Vec<serde_json::Value> {
    let rows: Vec<(String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT u.name, c.body, c.created_at FROM task_comments c JOIN users u ON u.id = c.user_id
         WHERE c.task_id = $1 ORDER BY c.created_at",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.iter().map(|(who, body, at)| json!({"author": who, "body": body, "at": at})).collect()
}

/// Fil de discussion d'une tâche (cahier : les membres commentent).
/// Lecture et écriture : connecté. 2000 caractères max.
pub async fn comments(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let out = comment_list(&s.pool, id).await;
    (StatusCode::OK, Json(out)).into_response()
}

/// Règle unique d'un commentaire (REST et MCP) : texte non vide, 2000 caractères max, tâche existante.
/// `from_ai` (MCP) : le texte enregistré est précédé de `[IA] ` ; la limite porte sur le texte saisi.
pub async fn post_comment(
    pool: &sqlx::PgPool,
    uid: uuid::Uuid,
    task_id: uuid::Uuid,
    body: &str,
    from_ai: bool,
) -> Result<(), (StatusCode, &'static str)> {
    let body = body.trim();
    if body.is_empty() || body.len() > 2000 {
        return Err((StatusCode::BAD_REQUEST, "bad-comment"));
    }
    let stored = if from_ai { crate::domain::validation::ai_comment(body) } else { body.to_string() };
    sqlx::query("INSERT INTO task_comments (task_id, user_id, body) VALUES ($1,$2,$3)")
        .bind(task_id)
        .bind(uid)
        .bind(stored)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|_| (StatusCode::NOT_FOUND, "bad-task"))
}

pub async fn add_comment(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(input): Json<CommentIn>,
) -> impl IntoResponse {
    let Ok((uid, _)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    match post_comment(&s.pool, uid, id, &input.body, false).await {
        Ok(()) => (StatusCode::CREATED, Json(json!({"ok": true}))).into_response(),
        Err((code, reason)) => (code, Json(json!({"error": reason}))).into_response(),
    }
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

/// Applique les réglages de validation à une écriture (`task_id` = None pour une création).
/// `None` : publier directement ; sinon la réponse à renvoyer (403 ou 202 + révision).
async fn gate(
    pool: &sqlx::PgPool,
    role: &str,
    task_id: Option<uuid::Uuid>,
    input: &TaskIn,
    uid: uuid::Uuid,
) -> Option<axum::response::Response> {
    let st = super::settings::load(pool).await;
    let mode = write_mode(
        role == "pilot",
        task_id.is_none(),
        st.validation_enabled,
        st.revalidate_on_edit,
        st.members_can_propose,
    );
    match mode {
        WriteMode::Publish => None,
        WriteMode::Forbidden => Some(
            (StatusCode::FORBIDDEN, Json(json!({"error": "members-cannot-propose"}))).into_response(),
        ),
        WriteMode::Propose => {
            let rev: Result<uuid::Uuid, _> = sqlx::query_scalar(
                "INSERT INTO task_revisions (task_id, payload, created_by) VALUES ($1, $2, $3) RETURNING id",
            )
            .bind(task_id)
            .bind(json!({
                "title": input.title, "axis_code": input.axis_code,
                "start_date": input.start_date, "end_date": input.end_date,
                "done_criteria": input.done_criteria, "description": input.description, "milestone": input.milestone,
                "assignments": input.assignments.iter().map(|a| json!({
                    "user_id": a.user_id, "role": a.role, "planned_hours": a.planned_hours
                })).collect::<Vec<_>>(),
            }))
            .bind(uid)
            .fetch_one(pool)
            .await;
            // Proposition non enregistrée : le dire, sinon le membre la croit en attente.
            Some(match rev {
                Ok(rev) => (StatusCode::ACCEPTED, Json(json!({"status": "pending-validation", "revision_id": rev})))
                    .into_response(),
                Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response(),
            })
        }
    }
}

/// Référentiel des axes (HARD, SOFT, IA, PILOTAGE, VIDEO). Connecté uniquement.
pub async fn axes(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT code, label FROM axes ORDER BY code")
        .fetch_all(&s.pool)
        .await
        .unwrap_or_default();
    Json(rows.iter().map(|(c, l)| json!({"code": c, "label": l})).collect::<Vec<_>>()).into_response()
}

/// Liste les tâches publiées, filtrables par axe et statut. Connecté uniquement.
pub async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(f): Query<TaskFilters>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let mut q = format!("SELECT {TASK_COLS} FROM tasks WHERE 1=1");
    // Paramètres numérotés $1.. construits dans l'ordre (axis, status, q).
    let mut n = 0;
    if f.axis.is_some() {
        n += 1;
        q += &format!(" AND axis_code = ${n}");
    }
    if f.status.is_some() {
        n += 1;
        q += &format!(" AND status = ${n}");
    }
    if f.q.as_ref().is_some_and(|s| !s.trim().is_empty()) {
        n += 1;
        q += &format!(" AND title ILIKE ${n}");
    }
    q += " ORDER BY start_date LIMIT 500";
    let mut query = sqlx::query_as::<_, TaskRow>(&q);
    if let Some(a) = f.axis {
        query = query.bind(a);
    }
    if let Some(st) = f.status {
        query = query.bind(st);
    }
    if let Some(s) = f.q {
        if !s.trim().is_empty() {
            query = query.bind(format!("%{}%", s.trim()));
        }
    }
    let rows = query.fetch_all(&s.pool).await.unwrap_or_default();
    let mut out = vec![];
    for row in rows {
        out.push(task_out(&s.pool, row).await);
    }
    (StatusCode::OK, Json(out)).into_response()
}

async fn task_out(pool: &sqlx::PgPool, row: TaskRow) -> TaskOut {
    let TaskRow { id, title, axis_code, start_date, end_date, status, done_criteria, description, milestone } = row;
    let assigns: Vec<(uuid::Uuid, String, f64)> =
        sqlx::query_as("SELECT user_id, role, planned_hours FROM assignments WHERE task_id = $1")
            .bind(id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    let deps: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT t.id, t.title FROM dependencies d JOIN tasks t ON t.id = d.pred_id WHERE d.succ_id = $1",
    )
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
        description,
        milestone,
        assignments: assigns
            .into_iter()
            .map(|(user_id, role, planned_hours)| AssignmentOut { user_id, role, planned_hours })
            .collect(),
        depends_on: deps.into_iter().map(|(id, title)| DepOut { id, title }).collect(),
    }
}

/// Fiche tâche : répartition, dépendances amont. Connecté uniquement.
pub async fn get(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    if current_user(&s.pool, &headers).await.is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    }
    let row: Option<TaskRow> =
        sqlx::query_as(&format!("SELECT {TASK_COLS} FROM tasks WHERE id = $1"))
            .bind(id)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    match row {
        Some(row) => (StatusCode::OK, Json(task_out(&s.pool, row).await)).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response(),
    }
}

/// Crée une tâche (pilote : publiée ; membre : selon les réglages F11, voir `gate`). Exige 1 lead.
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
    // F11 : selon les réglages, un membre propose (202 + révision), publie, ou n'a pas le droit.
    if let Some(r) = gate(&s.pool, &role, None, &input, uid).await {
        return r;
    }
    let milestone = input.milestone.unwrap_or(false);
    // Tâche + assignations en une transaction : jamais de tâche sans pilote.
    let mut tx = match s.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response(),
    };
    let id: uuid::Uuid = match sqlx::query_scalar(
        "INSERT INTO tasks (title, axis_code, start_date, end_date, done_criteria, milestone, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    )
    .bind(input.title.trim())
    .bind(&input.axis_code)
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.done_criteria.clone().unwrap_or_default())
    .bind(milestone)
    .bind(input.description.clone().unwrap_or_default())
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error": "insert-failed"}))).into_response(),
    };
    for a in &input.assignments {
        if sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(a.user_id)
        .bind(&a.role)
        .bind(a.planned_hours)
        .execute(&mut *tx)
        .await
        .is_err()
        {
            // Assignee inconnu : tout est annulé, pas de tâche bancale.
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-assignee"}))).into_response();
        }
    }
    if tx.commit().await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response();
    }
    (StatusCode::CREATED, Json(json!({"id": id}))).into_response()
}

/// Modifie une tâche (direct + cascade F2 ; membre : selon les réglages F11, voir `gate`).
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
    // F11 : selon les réglages, la modification d'un membre attend la validation
    // (l'ancienne version reste en vigueur), est publiée, ou est refusée.
    if let Some(r) = gate(&s.pool, &role, Some(id), &input, uid).await {
        return r;
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
    let mut tx = match s.pool.begin().await {
        Ok(tx) => tx,
        Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response(),
    };
    let n = sqlx::query(
        "UPDATE tasks SET title=$1, axis_code=$2, start_date=$3, end_date=$4,
         done_criteria=$5, milestone=$6, description=$8 WHERE id=$7",
    )
    .bind(input.title.trim())
    .bind(&input.axis_code)
    .bind(input.start_date)
    .bind(input.end_date)
    .bind(input.done_criteria.clone().unwrap_or_default())
    .bind(input.milestone.unwrap_or(false))
    .bind(id)
    .bind(input.description.clone().unwrap_or_default())
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if n == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not-found"}))).into_response();
    }
    if sqlx::query("DELETE FROM assignments WHERE task_id=$1").bind(id).execute(&mut *tx).await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response();
    }
    for a in &input.assignments {
        if sqlx::query(
            "INSERT INTO assignments (task_id, user_id, role, planned_hours) VALUES ($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(a.user_id)
        .bind(&a.role)
        .bind(a.planned_hours)
        .execute(&mut *tx)
        .await
        .is_err()
        {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-assignee"}))).into_response();
        }
    }
    if tx.commit().await.is_err() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "db"}))).into_response();
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

/// Règle unique du changement de statut (REST et MCP) : pilote du projet ou pilote de la tâche.
/// Erreur = (code HTTP, raison).
pub async fn change_status(
    pool: &sqlx::PgPool,
    uid: uuid::Uuid,
    role: &str,
    id: uuid::Uuid,
    status: &str,
) -> Result<(), (StatusCode, &'static str)> {
    if !matches!(status, "todo" | "in_progress" | "blocked" | "done") {
        return Err((StatusCode::BAD_REQUEST, "bad-status"));
    }
    if role != "pilot" {
        let lead: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT user_id FROM assignments WHERE task_id=$1 AND role='lead'",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        if lead != Some(uid) {
            return Err((StatusCode::FORBIDDEN, "lead-or-pilot-only"));
        }
    }
    let n = sqlx::query("UPDATE tasks SET status=$1 WHERE id=$2")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if n == 0 {
        return Err((StatusCode::NOT_FOUND, "not-found"));
    }
    Ok(())
}

/// Change le statut. Pilote projet ou pilote de la tâche uniquement.
pub async fn set_status(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(input): Json<StatusIn>,
) -> impl IntoResponse {
    let Ok((uid, role)) = current_user(&s.pool, &headers).await else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response();
    };
    match change_status(&s.pool, uid, &role, id, &input.status).await {
        Ok(()) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
        Err((code, reason)) => (code, Json(json!({"error": reason}))).into_response(),
    }
}
