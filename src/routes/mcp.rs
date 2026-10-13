use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::json;

/// MCP plein accès (D18) : transport Streamable HTTP `rmcp` en stateless,
/// monté ici en F1+. En attendant, 501 explicite au lieu d'un faux succès.
pub async fn not_ready_yet() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": "mcp-not-ready",
            "doc": "docs/mcp.md",
            "message": "Le serveur MCP arrive après la bascule (F5). Voir docs/mcp.md pour le contrat."
        })),
    )
}
