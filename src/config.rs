/// Config lue depuis l'environnement. Tout est String côté Cassiopée.
#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub app_url: String,
    /// Code temporaire pour /setup. Retiré par PUT après création du 1er compte.
    pub setup_code: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8080);
        Self {
            database_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/app".to_string()
            }),
            port,
            app_url: std::env::var("APP_URL").unwrap_or_else(|_| format!("http://localhost:{port}")),
            setup_code: std::env::var("SETUP_CODE").ok().filter(|s| !s.is_empty()),
        }
    }
}
