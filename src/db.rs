use sqlx::postgres::{PgPool, PgPoolOptions};

/// Pool Postgres (5 connexions max : quota 256Mi oblige). Panique si injoignable.
pub async fn connect(url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .expect("cannot connect to postgres")
}
