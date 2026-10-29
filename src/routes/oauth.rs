//! D27 : serveur d'autorisation OAuth 2.1 minimal du connecteur MCP (claude.ai, Cowork, mobile).
//! Découverte (RFC 9728 + 8414), enregistrement dynamique (RFC 7591), code + PKCE S256.
//! Le jeton délivré est un `api_tokens` ordinaire : même rôle, visible et révocable dans « Accès IA ».
use axum::{
    Form, Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use super::{AppState, current_user, sha256_hex};
use crate::domain::oauth::{pkce_ok, redirect_host};

/// RFC 9728 : `/.well-known/oauth-protected-resource[/mcp]`.
pub async fn protected_resource(State(s): State<AppState>) -> impl IntoResponse {
    let base = &s.public_url;
    Json(json!({
        "resource": format!("{base}/mcp"),
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
    }))
}

/// RFC 8414 : `/.well-known/oauth-authorization-server`.
pub async fn authorization_server(State(s): State<AppState>) -> impl IntoResponse {
    let base = &s.public_url;
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/oauth/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }))
}

#[derive(Deserialize)]
pub struct RegisterIn {
    #[serde(default)]
    redirect_uris: Vec<String>,
    client_name: Option<String>,
}

fn oauth_error(code: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error": code}))).into_response()
}

/// RFC 7591 : enregistrement d'un client public, sans authentification (comme l'exige claude.ai).
/// Seules les redirections vers claude.ai / claude.com ou la boucle locale passent.
pub async fn register(State(s): State<AppState>, Json(input): Json<RegisterIn>) -> Response {
    let uris = input.redirect_uris;
    if uris.is_empty() || uris.len() > 5 || uris.iter().any(|u| u.len() > 500 || redirect_host(u).is_none()) {
        return oauth_error("invalid_redirect_uri");
    }
    let name: String = input.client_name.unwrap_or_default().trim().chars().take(60).collect();
    // ponytail: plafond global contre le remplissage par une route publique ; purge par date si un jour atteint.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_clients")
        .fetch_one(&s.pool)
        .await
        .unwrap_or(i64::MAX);
    if count >= 500 {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "too-many-clients"}))).into_response();
    }
    let id: uuid::Uuid =
        sqlx::query_scalar("INSERT INTO oauth_clients (name, redirect_uris) VALUES ($1, $2) RETURNING id")
            .bind(&name)
            .bind(&uris)
            .fetch_one(&s.pool)
            .await
            .unwrap();
    (
        StatusCode::CREATED,
        Json(json!({
            "client_id": id,
            "client_name": name,
            "redirect_uris": uris,
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })),
    )
        .into_response()
}

/// Paramètres de `/oauth/authorize`, en GET (query) puis renvoyés en POST (formulaire de consentement).
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct AuthorizeIn {
    response_type: String,
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    code_challenge_method: String,
    state: String,
    // POST seulement.
    decision: String,
    email: String,
    password: String,
}

/// Nom du client si `client_id` existe et que `redirect_uri` fait partie de ses URI enregistrées.
/// Sinon on ne redirige **pas** (RFC 6749 §4.1.2.1) : page d'erreur.
async fn check_client(s: &AppState, p: &AuthorizeIn) -> Result<String, &'static str> {
    let Ok(cid) = p.client_id.parse::<uuid::Uuid>() else {
        return Err("Client inconnu.");
    };
    let row: Option<(String, Vec<String>)> =
        sqlx::query_as("SELECT name, redirect_uris FROM oauth_clients WHERE id = $1")
            .bind(cid)
            .fetch_optional(&s.pool)
            .await
            .unwrap_or(None);
    let Some((name, uris)) = row else {
        return Err("Client inconnu.");
    };
    if !uris.contains(&p.redirect_uri) {
        return Err("Adresse de retour non enregistrée pour ce client.");
    }
    if p.response_type != "code" || p.code_challenge_method != "S256" || p.code_challenge.is_empty() {
        return Err("Paramètres invalides : code + PKCE S256 obligatoires.");
    }
    Ok(if name.is_empty() { "Client MCP".into() } else { name })
}

/// Écran de consentement. Connecté : bouton « Autoriser ». Sinon : e-mail + mot de passe sur la même page.
pub async fn authorize_page(State(s): State<AppState>, headers: HeaderMap, Query(p): Query<AuthorizeIn>) -> Response {
    let client = match check_client(&s, &p).await {
        Ok(c) => c,
        Err(msg) => return page(StatusCode::BAD_REQUEST, &format!("<h1>Demande refusée</h1><p>{msg}</p>")),
    };
    let who = match current_user(&s.pool, &headers).await {
        Ok((uid, _)) => user_label(&s, uid).await,
        Err(_) => None,
    };
    consent(StatusCode::OK, &p, &client, who.as_deref(), None)
}

/// Décision du formulaire : refus → `error=access_denied` ; accord → code à usage unique (5 min).
pub async fn authorize_submit(State(s): State<AppState>, headers: HeaderMap, Form(p): Form<AuthorizeIn>) -> Response {
    let client = match check_client(&s, &p).await {
        Ok(c) => c,
        Err(msg) => return page(StatusCode::BAD_REQUEST, &format!("<h1>Demande refusée</h1><p>{msg}</p>")),
    };
    if p.decision != "allow" {
        return redirect(&p.redirect_uri, &[("error", "access_denied"), ("state", &p.state)]);
    }
    // Session web d'abord (cookie Lax : absent d'un POST venu d'un autre site), sinon identifiants.
    let uid = match current_user(&s.pool, &headers).await {
        Ok((uid, _)) => uid,
        Err(_) => {
            let row: Option<(uuid::Uuid, String)> =
                sqlx::query_as("SELECT id, password_hash FROM users WHERE email = $1")
                    .bind(p.email.trim())
                    .fetch_optional(&s.pool)
                    .await
                    .unwrap_or(None);
            match row {
                Some((id, hash)) if crate::auth::verify_password(&hash, &p.password) => id,
                _ => return consent(StatusCode::UNAUTHORIZED, &p, &client, None, Some("E-mail ou mot de passe incorrect.")),
            }
        }
    };
    let code = random_code();
    let _ = sqlx::query("DELETE FROM oauth_codes WHERE expires_at < now()").execute(&s.pool).await;
    sqlx::query(
        "INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '5 minutes')",
    )
    .bind(sha256_hex(&code))
    .bind(p.client_id.parse::<uuid::Uuid>().unwrap())
    .bind(uid)
    .bind(&p.redirect_uri)
    .bind(&p.code_challenge)
    .execute(&s.pool)
    .await
    .unwrap();
    redirect(&p.redirect_uri, &[("code", &code), ("state", &p.state)])
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TokenIn {
    grant_type: String,
    code: String,
    redirect_uri: String,
    client_id: String,
    code_verifier: String,
}

/// Échange code + verifier PKCE contre un token `ls_…` (sans expiration, révocable, comme D18).
pub async fn token(State(s): State<AppState>, Form(t): Form<TokenIn>) -> Response {
    if t.grant_type != "authorization_code" {
        return oauth_error("unsupported_grant_type");
    }
    // DELETE … RETURNING : usage unique même si deux échanges arrivent en même temps.
    let row: Option<(uuid::Uuid, uuid::Uuid, String, String, bool, String)> = sqlx::query_as(
        "DELETE FROM oauth_codes c USING oauth_clients k WHERE c.code_hash = $1 AND k.id = c.client_id
         RETURNING c.client_id, c.user_id, c.redirect_uri, c.code_challenge, c.expires_at > now(), k.name",
    )
    .bind(sha256_hex(&t.code))
    .fetch_optional(&s.pool)
    .await
    .unwrap_or(None);
    let Some((cid, uid, redirect_uri, challenge, fresh, name)) = row else {
        return oauth_error("invalid_grant");
    };
    let ok = fresh
        && t.client_id == cid.to_string()
        && t.redirect_uri == redirect_uri
        && pkce_ok(&t.code_verifier, &challenge);
    if !ok {
        return oauth_error("invalid_grant");
    }
    let label: String = if name.is_empty() { "OAuth".into() } else { name };
    let (_, token) = crate::routes::me::new_api_token(&s.pool, uid, &label).await;
    (
        StatusCode::OK,
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"access_token": token, "token_type": "Bearer"})),
    )
        .into_response()
}

async fn user_label(s: &AppState, uid: uuid::Uuid) -> Option<String> {
    let (name, role): (String, String) = sqlx::query_as("SELECT name, role FROM users WHERE id = $1")
        .bind(uid)
        .fetch_optional(&s.pool)
        .await
        .ok()??;
    Some(format!("{name} ({})", if role == "pilot" { "pilote" } else { "membre" }))
}

fn random_code() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
}

/// Encodage `application/x-www-form-urlencoded` d'une valeur (RFC 3986, caractères non réservés gardés).
fn pct(v: &str) -> String {
    v.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn redirect(uri: &str, params: &[(&str, &str)]) -> Response {
    let q: Vec<String> = params.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| format!("{k}={}", pct(v))).collect();
    let sep = if uri.contains('?') { '&' } else { '?' };
    (StatusCode::SEE_OTHER, [(header::LOCATION, format!("{uri}{sep}{}", q.join("&")))]).into_response()
}

fn esc(v: &str) -> String {
    v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn consent(code: StatusCode, p: &AuthorizeIn, client: &str, who: Option<&str>, error: Option<&str>) -> Response {
    let hidden: String = [
        ("response_type", &p.response_type),
        ("client_id", &p.client_id),
        ("redirect_uri", &p.redirect_uri),
        ("code_challenge", &p.code_challenge),
        ("code_challenge_method", &p.code_challenge_method),
        ("state", &p.state),
    ]
    .iter()
    .map(|(k, v)| format!(r#"<input type="hidden" name="{k}" value="{}">"#, esc(v)))
    .collect();
    let host = redirect_host(&p.redirect_uri).unwrap_or_default();
    let login = match who {
        Some(w) => format!("<p>Connecté en tant que <b>{}</b>.</p>", esc(w)),
        None => r#"<label>E-mail<input name="email" type="email" autocomplete="username" required autofocus></label>
<label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>"#
            .into(),
    };
    let error = error.map(|e| format!(r#"<p class="err" role="alert">{}</p>"#, esc(e))).unwrap_or_default();
    page(
        code,
        &format!(
            r#"<h1>Autoriser {client}</h1>
<p><b>{client}</b> pourra lire le planning et agir en ton nom (heures, statuts, commentaires), avec ton rôle. Retour vers <code>{host}</code>.</p>
<p class="muted">Révocable à tout moment : menu du compte › Accès IA.</p>
<form method="post" action="/oauth/authorize">{hidden}{login}{error}
<div class="row"><button name="decision" value="allow">Autoriser</button><button name="decision" value="deny" formnovalidate class="ghost">Refuser</button></div>
</form>"#,
            client = esc(client),
            host = esc(host),
        ),
    )
}

/// Page HTML autonome (hors SPA), interdite en iframe contre le clickjacking.
fn page(code: StatusCode, body: &str) -> Response {
    let html = format!(
        r#"<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès IA · Suivi projet</title>
<style>
:root{{color-scheme:light dark;--bg:light-dark(oklch(0.975 0.004 260),oklch(0.17 0.012 265));--s:light-dark(oklch(1 0 0),oklch(0.205 0.014 265));--t1:light-dark(oklch(0.22 0.015 265),oklch(0.95 0.005 265));--t2:light-dark(oklch(0.42 0.015 265),oklch(0.74 0.012 265));--b:light-dark(oklch(0.9 0.006 260),oklch(0.29 0.014 265));--a:light-dark(oklch(0.53 0.2 278),oklch(0.68 0.16 280));--on:light-dark(oklch(1 0 0),oklch(0.18 0.03 275));--err:light-dark(oklch(0.55 0.2 25),oklch(0.72 0.16 25))}}
body{{margin:0;background:var(--bg);color:var(--t1);font:15px/1.5 Geist,system-ui,sans-serif}}
main{{max-width:26rem;margin:10vh auto;padding:24px;background:var(--s);border:1px solid var(--b);border-radius:12px}}
@media (max-width:480px){{main{{margin:16px;padding:16px}}}}
h1{{font-size:18px;margin:0 0 12px}}.muted{{color:var(--t2);font-size:13px}}.err{{color:var(--err)}}
label{{display:block;margin:12px 0;font-size:13px;color:var(--t2)}}
input{{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;font:inherit;color:var(--t1);background:var(--bg);border:1px solid var(--b);border-radius:8px}}
.row{{display:flex;gap:8px;margin-top:16px}}button{{flex:1;padding:9px;font:inherit;font-weight:500;border-radius:8px;border:1px solid var(--a);background:var(--a);color:var(--on);cursor:pointer}}
button.ghost{{background:transparent;color:var(--t1);border-color:var(--b)}}:focus-visible{{outline:2px solid var(--a);outline-offset:2px}}
</style></head><body><main>{body}</main></body></html>"#
    );
    (
        code,
        [
            (header::X_FRAME_OPTIONS, "DENY"),
            (header::CONTENT_SECURITY_POLICY, "frame-ancestors 'none'"),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        Html(html),
    )
        .into_response()
}
