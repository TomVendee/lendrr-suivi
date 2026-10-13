use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn connect(url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .expect("cannot connect to postgres")
}
