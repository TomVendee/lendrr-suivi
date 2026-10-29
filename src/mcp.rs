use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::request::Parts,
    response::IntoResponse,
};
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
    state: crate::routes::AppState,
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
pub struct UpdateStatusArgs {
    pub task_id: String,
    /// `todo`, `in_progress`, `blocked` ou `done`. Pour un jalon, `done` = atteint.
    pub status: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddCommentArgs {
    pub task_id: String,
    /// Texte du commentaire, 2000 caractères maximum. Signé du nom du propriétaire du token et précédé de « [IA] ».
    pub body: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskIdArgs {
    pub task_id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
pub struct UpdateTaskArgs {
    pub task_id: String,
    /// Version complète de la tâche (tous les champs, comme à la création).
    #[serde(flatten)]
    pub task: crate::routes::tasks::TaskIn,
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

fn task_id(s: &str) -> Result<uuid::Uuid, ErrorData> {
    s.parse().map_err(|_| ErrorData::invalid_params("bad-task-id", None))
}

/// Pont vers un handler REST : mêmes contrôles de rôle et de saisie que l'écran (D18).
/// Le handler lit le même `Authorization: Bearer` ; un statut d'erreur devient `-32602` avec son `error`.
async fn rest(resp: impl IntoResponse) -> Result<CallToolResult, ErrorData> {
    let resp = resp.into_response();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), 8 << 20)
        .await
        .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
    let v: serde_json::Value = serde_json::from_slice(&body)
        .unwrap_or_else(|_| serde_json::Value::String(String::from_utf8_lossy(&body).into()));
    if status.is_success() {
        Ok(text(v))
    } else {
        let reason = v.get("error").and_then(|e| e.as_str()).unwrap_or(status.as_str()).to_string();
        Err(ErrorData::invalid_params(reason, None))
    }
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
        let (uid, _) = user_from_parts(&self.state.pool, &parts).await?;
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
            .fetch_all(&self.state.pool)
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
        .fetch_one(&self.state.pool)
        .await
        .unwrap_or(0.0);
        let capacity: f64 = sqlx::query_scalar(
            "SELECT COALESCE((SELECT hours FROM capacity_overrides WHERE user_id=$1 AND week=$2),
                             (SELECT default_capacity_hours FROM users WHERE id=$1))",
        )
        .bind(uid)
        .bind(week)
        .fetch_one(&self.state.pool)
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
        let _ = user_from_parts(&self.state.pool, &parts).await?;
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
            .fetch_all(&self.state.pool)
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
        let (uid, role) = user_from_parts(&self.state.pool, &parts).await?;
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
        .fetch_one(&self.state.pool)
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
        .execute(&self.state.pool)
        .await
        .map_err(|_| ErrorData::invalid_params("bad-task", None))?;
        Ok(text(serde_json::json!({"ok": true})))
    }

    #[tool(description = "Changer le statut d'une tache ou d'un jalon : todo, in_progress, blocked, done (jalon atteint). Reserve au pilote du projet ou au responsable de la tache")]
    async fn update_task_status(
        &self,
        Parameters(args): Parameters<UpdateStatusArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, role) = user_from_parts(&self.state.pool, &parts).await?;
        let task_id: uuid::Uuid = args
            .task_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-task-id", None))?;
        crate::routes::tasks::change_status(&self.state.pool, uid, &role, task_id, &args.status)
            .await
            .map_err(|(_, reason)| ErrorData::invalid_params(reason, None))?;
        Ok(text(serde_json::json!({"ok": true, "task_id": task_id, "status": args.status})))
    }

    #[tool(description = "Poster un commentaire sur une tache (fil de discussion). Signe du nom du proprietaire du token et precede de [IA], 2000 caracteres max")]
    async fn add_task_comment(
        &self,
        Parameters(args): Parameters<AddCommentArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, _) = user_from_parts(&self.state.pool, &parts).await?;
        let task_id: uuid::Uuid = args
            .task_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-task-id", None))?;
        crate::routes::tasks::post_comment(&self.state.pool, uid, task_id, &args.body, true)
            .await
            .map_err(|(_, reason)| ErrorData::invalid_params(reason, None))?;
        Ok(text(serde_json::json!({"ok": true, "task_id": task_id})))
    }

    #[tool(description = "Lire le fil de discussion d'une tache, du plus ancien au plus recent (auteur, texte, date). A consulter avant de commenter pour eviter les doublons")]
    async fn list_task_comments(
        &self,
        Parameters(args): Parameters<TaskIdArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        user_from_parts(&self.state.pool, &parts).await?;
        let task_id: uuid::Uuid = args
            .task_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-task-id", None))?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1)")
            .bind(task_id)
            .fetch_one(&self.state.pool)
            .await
            .unwrap_or(false);
        if !exists {
            return Err(ErrorData::invalid_params("bad-task", None));
        }
        Ok(text(serde_json::Value::Array(crate::routes::tasks::comment_list(&self.state.pool, task_id).await)))
    }

    /// Lister les alertes (les siennes pour un membre, toutes pour le pilote).
    #[tool(description = "Lister les alertes : surcharges, retards, heures manquantes, jalons menaces")]
    async fn list_alerts(
        &self,
        Parameters(_): Parameters<NoArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let (uid, role) = user_from_parts(&self.state.pool, &parts).await?;
        let alerts = crate::routes::stats::compute_alerts(&self.state.pool, uid, &role).await;
        Ok(text(serde_json::json!({"alerts": alerts})))
    }

    #[tool(description = "Lister les revisions en attente de validation (nouvelles taches proposees, modifications) avec leur contenu. Pilote, validateur ou suppleant")]
    async fn list_revisions(&self, Extension(parts): Extension<Parts>) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::revisions::list(State(self.state.clone()), parts.headers).await).await
    }

    /// Valider ou rejeter une tâche en attente (pilote, validateur, suppléant).
    #[tool(description = "Valider ou rejeter une revision en attente (id donne par list_revisions). Pilote, validateur ou suppleant. Refuse sans exactement un lead")]
    async fn validate_task(
        &self,
        Parameters(args): Parameters<ValidateTaskArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let rev = args
            .revision_id
            .parse()
            .map_err(|_| ErrorData::invalid_params("bad-revision-id", None))?;
        let input = crate::routes::revisions::DecideIn { approve: args.approve };
        rest(crate::routes::revisions::decide(State(self.state.clone()), parts.headers, Path(rev), Json(input)).await).await
    }

    #[tool(description = "Fiche complete d'une tache : dates, statut, critere Termine quand, description, jalon, collaborateurs (lead, support, heures prevues), dependances amont")]
    async fn get_task(
        &self,
        Parameters(args): Parameters<TaskIdArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let id = task_id(&args.task_id)?;
        rest(crate::routes::tasks::get(State(self.state.clone()), parts.headers, Path(id)).await).await
    }

    #[tool(description = "Equipe : identifiant, nom, capacite par defaut et capacites par semaine (absences). Les identifiants servent aux collaborateurs d'une tache")]
    async fn list_team(&self, Extension(parts): Extension<Parts>) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::stats::capacities(State(self.state.clone()), parts.headers).await).await
    }

    #[tool(description = "Plan de charge personne x semaine : heures prevues, reelles, capacite. Defaut : 2 semaines avant a 6 apres la semaine courante")]
    async fn list_load(
        &self,
        Parameters(args): Parameters<crate::routes::stats::LoadQ>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::stats::load(State(self.state.clone()), parts.headers, Query(args)).await).await
    }

    #[tool(description = "Gantt : taches, dependances, marges et chemin critique (taches sans marge). Filtrable par axe")]
    async fn gantt_data(
        &self,
        Parameters(args): Parameters<crate::routes::views::GanttQ>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::views::gantt(State(self.state.clone()), parts.headers, Query(args)).await).await
    }

    #[tool(description = "Meteo par axe : etat de chaque axe (avancement, retards, jalons)")]
    async fn meteo_data(&self, Extension(parts): Extension<Parts>) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::views::meteo(State(self.state.clone()), parts.headers).await).await
    }

    #[tool(description = "Synthese hebdomadaire en texte a trous a relire (pilote). Defaut : semaine courante")]
    async fn weekly_synthesis(
        &self,
        Parameters(args): Parameters<crate::routes::report::WeekQ>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::report::synthesis(State(self.state.clone()), parts.headers, Query(args)).await).await
    }

    #[tool(description = "Creer une tache. Pilote : publiee directement. Membre : proposee en attente de validation selon les reglages. Exactement un lead parmi les collaborateurs")]
    async fn create_task(
        &self,
        Parameters(args): Parameters<crate::routes::tasks::TaskIn>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::tasks::create(State(self.state.clone()), parts.headers, Json(args)).await).await
    }

    #[tool(description = "Modifier une tache (version complete : lire get_task d'abord). Pilote : publie, avec decalage automatique des successeurs. Membre : modification en attente, l'ancienne version reste en vigueur")]
    async fn update_task(
        &self,
        Parameters(args): Parameters<UpdateTaskArgs>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        let id = task_id(&args.task_id)?;
        rest(crate::routes::tasks::update(State(self.state.clone()), parts.headers, Path(id), Json(args.task)).await).await
    }

    #[tool(description = "Ajouter une dependance fin-debut (le predecesseur finit avant que le successeur commence). Pilote uniquement, cycle refuse")]
    async fn add_dependency(
        &self,
        Parameters(args): Parameters<crate::routes::deps::DepIn>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::deps::create(State(self.state.clone()), parts.headers, Json(args)).await).await
    }

    #[tool(description = "Supprimer une dependance entre deux taches. Pilote uniquement")]
    async fn remove_dependency(
        &self,
        Parameters(args): Parameters<crate::routes::deps::DepIn>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::deps::delete(State(self.state.clone()), parts.headers, Json(args)).await).await
    }

    #[tool(description = "Fixer la capacite d'une personne pour une semaine (absence = 0 h, 0 a 80 h). Pilote uniquement")]
    async fn set_capacity(
        &self,
        Parameters(args): Parameters<crate::routes::stats::CapacityIn>,
        Extension(parts): Extension<Parts>,
    ) -> Result<CallToolResult, ErrorData> {
        rest(crate::routes::stats::set_capacity(State(self.state.clone()), parts.headers, Json(args)).await).await
    }
}

pub type McpService = StreamableHttpService<SuiviMcp, LocalSessionManager>;

/// Monte le serveur MCP en HTTP streamable **stateless** (D18) : aucune session
/// en mémoire, donc compatible répliques multiples et redémarrages.
pub fn streamable_service(state: crate::routes::AppState, app_host: Option<String>) -> McpService {
    // rmcp n'accepte que localhost par défaut (anti DNS-rebinding) : on ajoute l'hôte public.
    let hosts = ["localhost", "127.0.0.1", "::1"].map(String::from).into_iter().chain(app_host);
    StreamableHttpService::new(
        move || Ok(SuiviMcp { state: state.clone() }),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().with_legacy_session_mode(false).with_allowed_hosts(hosts),
    )
}
