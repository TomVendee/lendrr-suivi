//! Suivi projet (LENDRR) — serveur unique Axum : API `/api`, MCP `/mcp`, front statique.
//! Une seule image Docker, Postgres managé, migrations au démarrage (D2, D6).
use std::net::SocketAddr;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod config;
mod db;
mod domain;
mod mcp;
mod routes;
mod web;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = config::Config::from_env();
    let pool = db::connect(&cfg.database_url).await;
    sqlx::migrate!("./db/migrations")
        .run(&pool)
        .await
        .expect("migrations failed");

    tokio::spawn(routes::report::housekeeping(pool.clone()));
    let addr: SocketAddr = format!("0.0.0.0:{}", cfg.port).parse().expect("bad port");
    let app = routes::router(pool, cfg);
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
