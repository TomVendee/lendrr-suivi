/// Config lue depuis l'environnement. Tout est String.
#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    /// `Secure` sur les cookies sauf si `APP_URL` est en http (dev local). Absent → `Secure`.
    pub secure_cookies: bool,
    /// Code temporaire pour /setup. Retiré par PUT après création du 1er compte.
    pub setup_code: Option<String>,
    /// Hôte public (depuis `APP_URL`), accepté par le MCP en plus de localhost.
    pub app_host: Option<String>,
}

/// `https://planning.ipv6-sigl.fr/x` → `planning.ipv6-sigl.fr` (port conservé).
fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let host = rest.split(['/', '?', '#']).next()?.trim();
    (!host.is_empty()).then(|| host.to_string())
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
            secure_cookies: !std::env::var("APP_URL").unwrap_or_default().starts_with("http://"),
            setup_code: std::env::var("SETUP_CODE").ok().filter(|s| !s.is_empty()),
            app_host: std::env::var("APP_URL").ok().and_then(|u| host_of(&u)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::host_of;

    #[test]
    fn host_of_url() {
        assert_eq!(host_of("https://planning.ipv6-sigl.fr/").as_deref(), Some("planning.ipv6-sigl.fr"));
        assert_eq!(host_of("http://localhost:8080").as_deref(), Some("localhost:8080"));
        assert_eq!(host_of("").as_deref(), None);
    }
}
