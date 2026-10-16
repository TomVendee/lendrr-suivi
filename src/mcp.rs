use std::sync::Arc;

use axum::http::request::Parts;
use rmcp::{
    ErrorData,
    handler::server::{tool::Extension, wrapper::Parameters},
    model::{CallToolResult, ContentBlock},
    schemars, tool, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager,
        tower::{StreamableHttpServerConfig, StreamableHttpService},
    },
};
use serde::Deserialize;

use crate::domain::{
    load::{Allocation, planned_load},
    working_days::{project_week, today_paris, week_bounds},
};

#[derive(Clone)]
pub struct SuiviMcp {
    pool: sqlx::PgPool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MyWeekArgs {
    /// Semaine projet (S01 = 24/08/2026). Défaut : semaine courante (Europe/Paris).
    pub week: Option<i32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListTasksArgs {
    pub axis: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LogHoursArgs {
    pub task_id: String,
    pub week: i32,
    pub hours: f64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ValidateTaskArgs {
    pub revision_id: String,
    pub approve: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NoArgs {}


async fn user_from_parts(
    pool: &sqlx::PgPool,
    parts: &Parts,
) -> Result<(uuid::Uuid, String), ErrorData> {
    let tok = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ErrorData::invalid_params("missing-bearer-token", None))?;
    let digest = crate::routes::sha256_hex(tok);
    sqlx::query_as::<_, (uuid::Uuid, String)>(
        "SELECT u.id, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND NOT t.revoked",
    )
    .bind(digest)
    .fetch_optional(pool)
    .await
    .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
    .ok_or_else(|| ErrorData::invalid_params("bad-or-revoked-token", None))
}

fn text(v: serde_json::Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(v.to_string())])
}

#[tool_router(server_handler)]
impl SuiviMcp {
    /// Ma semaine : mes tâches, charge prévue/réelle/capacité.
    #[tool(description = "Ma semaine : taches assignees, charge prevue/reelle/capacite")]
    async fn my_week(
        &self,
        Parameters(args): Parameters<MyWeekArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, _) = user_from_parts(&self.pool, &parts).await?;
        let week = args.week.unwrap_or_else(|| project_week(today_paris()));
        let (wmon, wsun) = week_bounds(week);
        type Row = (uuid::Uuid, String, String, chrono::NaiveDate, chrono::NaiveDate, String, String, f64);
        let rows: Vec<Row> =
            sqlx::query_as(
                "SELECT t.id, t.title, t.axis_code, t.start_date, t.end_date, t.status, a.role, a.planned_hours
                 FROM tasks t JOIN assignments a ON a.task_id = t.id
                 WHERE a.user_id = $1 AND t.start_date <= $2 AND t.end_date >= $3
                 ORDER BY t.start_date",
            )
            .bind(uid)
            .bind(wsun)
            .bind(wmon)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let mut allocs = vec![];
        let mut tasks = vec![];
        for (id, title, axis, sd, ed, st, role, hours) in &rows {
            allocs.push(Allocation { task_start: *sd, task_end: *ed, hours: *hours });
            tasks.push(serde_json::json!({
                "id": id, "title": title, "axis": axis, "start": sd, "end": ed,
                "status": st, "my_role": role, "planned_hours": hours,
            }));
        }
        let planned = planned_load(&allocs, week);
        let real: f64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(hours),0) FROM time_entries WHERE user_id=$1 AND week=$2",
        )
        .bind(uid)
        .bind(week)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(0.0);
        let capacity: f64 = sqlx::query_scalar(
            "SELECT COALESCE((SELECT hours FROM capacity_overrides WHERE user_id=$1 AND week=$2),
                             (SELECT default_capacity_hours FROM users WHERE id=$1))",
        )
        .bind(uid)
        .bind(week)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(4.0);
        Ok(text(serde_json::json!({
            "week": week, "tasks": tasks,
            "planned": planned, "real": real, "capacity": capacity,
        })))
    }

    /// Liste les tâches publiées, filtrables par axe et statut.
    #[tool(description = "Lister les taches du planning, filtrables par axe et statut")]
    async fn list_tasks(
        &self,
        Parameters(args): Parameters<ListTasksArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let _ = user_from_parts(&self.pool, &parts).await?;
        let mut q = "SELECT id::text, title, axis_code, start_date::text, end_date::text, status FROM tasks WHERE 1=1".to_string();
        if args.axis.is_some() {
            q += " AND axis_code = $1";
        }
        if args.status.is_some() {
            q += if args.axis.is_some() { " AND status = $2" } else { " AND status = $1" };
        }
        q += " ORDER BY start_date LIMIT 200";
        let mut query = sqlx::query_as::<_, (String, String, String, String, String, String)>(&q);
        if let Some(a) = args.axis {
            query = query.bind(a);
        }
        if let Some(st) = args.status {
            query = query.bind(st);
        }
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        Ok(text(serde_json::json!(rows
            .iter()
            .map(|(id, t, a, s, e, st)| serde_json::json!({
                "id": id, "title": t, "axis": a, "start": s, "end": e, "status": st,
            }))
            .collect::<Vec<_>>())))
    }

    /// Déclarer des heures réelles sur une tâche pour une semaine (re-poster corrige).
    #[tool(description = "Declarer les heures reelles passees sur une tache pour une semaine")]
    async fn log_hours(
        &self,
        Parameters(args): Parameters<LogHoursArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, role) = user_from_parts(&self.pool, &parts).await?;
        if !(0.0..=80.0).contains(&args.hours) {
            return Err(ErrorData::invalid_params("bad-hours", None));
        }
        let task_id: uuid::Uuid = args
            .task_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-task-id", None))?;
        let assigned: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM assignments WHERE task_id=$1 AND user_id=$2)",
        )
        .bind(task_id)
        .bind(uid)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(false);
        if !assigned && role != "pilot" {
            return Err(ErrorData::invalid_params("not-assigned", None));
        }
        sqlx::query(
            "INSERT INTO time_entries (task_id, user_id, week, hours) VALUES ($1,$2,$3,$4)
             ON CONFLICT (task_id, user_id, week) DO UPDATE SET hours = EXCLUDED.hours",
        )
        .bind(task_id)
        .bind(uid)
        .bind(args.week)
        .bind(args.hours)
        .execute(&self.pool)
        .await
        .map_err(|_| ErrorData::invalid_params("bad-task", None))?;
        Ok(text(serde_json::json!({"ok": true})))
    }

    /// Lister les alertes (les siennes pour un membre, toutes pour le pilote).
    #[tool(description = "Lister les alertes : surcharges, retards, heures manquantes, jalons menaces")]
    async fn list_alerts(
        &self,
        Parameters(_): Parameters<NoArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, role) = user_from_parts(&self.pool, &parts).await?;
        let alerts = crate::routes::stats::compute_alerts(&self.pool, uid, &role).await;
        Ok(text(serde_json::json!({"alerts": alerts})))
    }

    /// Valider ou rejeter une tâche en attente (pilote, validateur, suppléant).
    #[tool(description = "Valider ou rejeter une tache en attente de validation (pilote, validateur ou suppleant)")]
    async fn validate_task(
        &self,
        Parameters(args): Parameters<ValidateTaskArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, role) = user_from_parts(&self.pool, &parts).await?;
        if !crate::routes::settings::load(&self.pool).await.can_decide(uid, &role) {
            return Err(ErrorData::invalid_params("not-a-validator", None));
        }
        let rev: uuid::Uuid = args
            .revision_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-revision-id", None))?;
        let row: Option<(Option<uuid::Uuid>, serde_json::Value)> = sqlx::query_as(
            "SELECT task_id, payload FROM task_revisions WHERE id=$1 AND status='pending'",
        )
        .bind(rev)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let Some((task_id, payload)) = row else {
            return Err(ErrorData::invalid_params("not-found", None));
        };
        if !args.approve {
            let _ = sqlx::query("UPDATE task_revisions SET status='rejected' WHERE id=$1")
                .bind(rev)
                .execute(&self.pool)
                .await;
            return Ok(text(serde_json::json!({"decision": "rejected"})));
        }
        match crate::routes::revisions::apply_payload(&self.pool, task_id, &payload).await {
            Ok(a) => {
                let _ = sqlx::query("UPDATE task_revisions SET status='validated' WHERE id=$1")
                    .bind(rev)
                    .execute(&self.pool)
                    .await;
                Ok(text(serde_json::json!({"decision": "validated", "task_id": a.id,
                    "shifted": a.shifted, "milestones_threatened": a.threatened})))
            }
            Err(reason) => Err(ErrorData::invalid_params(reason, None)),
        }
    }
}

pub type McpService = StreamableHttpService<SuiviMcp, LocalSessionManager>;

/// Monte le serveur MCP en HTTP streamable **stateless** (D18) : aucune session
/// en mémoire, donc compatible répliques multiples et redémarrages.
pub fn streamable_service(pool: sqlx::PgPool, app_host: Option<String>) -> McpService {
    // rmcp n'accepte que localhost par défaut (anti DNS-rebinding) : on ajoute l'hôte public.
    let hosts = ["localhost", "127.0.0.1", "::1"].map(String::from).into_iter().chain(app_host);
    StreamableHttpService::new(
        move || Ok(SuiviMcp { pool: pool.clone() }),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().with_legacy_session_mode(false).with_allowed_hosts(hosts),
    )
}
