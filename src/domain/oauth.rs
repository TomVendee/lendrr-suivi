//! OAuth 2.1 du connecteur MCP (D27) : règles pures, sans I/O.

/// PKCE S256 (RFC 7636) : `base64url(sha256(verifier)) == challenge`.
/// Le verifier fait 43 à 128 caractères non réservés.
pub fn pkce_ok(verifier: &str, challenge: &str) -> bool {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let charset_ok = verifier
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b));
    if !(43..=128).contains(&verifier.len()) || !charset_ok {
        return false;
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) == challenge
}

/// Hôte d'une URI de redirection, si elle est acceptée : `https://claude.ai|claude.com/…`
/// (connecteurs web) ou boucle locale en http/https (Claude Code, clients de bureau).
/// Refus : fragment, identifiants dans l'autorité, tout autre hôte.
pub fn redirect_host(uri: &str) -> Option<&str> {
    let (scheme, rest) = uri.split_once("://")?;
    if uri.contains('#') {
        return None;
    }
    let authority = rest.split(['/', '?']).next()?;
    if authority.contains('@') {
        return None;
    }
    let host = match authority.strip_prefix('[') {
        Some(v6) => v6.split_once(']').map(|(h, _)| h)?,
        None => authority.split(':').next()?,
    };
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    let claude = matches!(host, "claude.ai" | "claude.com");
    match scheme {
        "https" if local || claude => Some(host),
        "http" if local => Some(host),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_rfc7636_example() {
        // Annexe B de la RFC 7636.
        let v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert!(pkce_ok(v, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
        assert!(!pkce_ok(v, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cX"));
    }

    #[test]
    fn pkce_rejects_bad_verifier() {
        assert!(!pkce_ok("court", "x"));
        assert!(!pkce_ok(&"a".repeat(129), "x"));
        assert!(!pkce_ok(&format!("{}+", "a".repeat(43)), "x"));
    }

    #[test]
    fn redirect_claude_and_loopback() {
        assert_eq!(redirect_host("https://claude.ai/api/mcp/auth_callback"), Some("claude.ai"));
        assert_eq!(redirect_host("https://claude.com/api/mcp/auth_callback"), Some("claude.com"));
        assert_eq!(redirect_host("http://localhost:33418/callback"), Some("localhost"));
        assert_eq!(redirect_host("http://127.0.0.1:9000/cb?x=1"), Some("127.0.0.1"));
        assert_eq!(redirect_host("http://[::1]:9000/cb"), Some("::1"));
    }

    #[test]
    fn redirect_rejects_others() {
        assert_eq!(redirect_host("http://claude.ai/cb"), None, "http hors boucle locale");
        assert_eq!(redirect_host("https://evil.com/cb"), None);
        assert_eq!(redirect_host("https://claude.ai.evil.com/cb"), None);
        assert_eq!(redirect_host("https://evil.com@claude.ai/cb"), None, "identifiants dans l'autorité");
        assert_eq!(redirect_host("https://claude.ai/cb#frag"), None);
        assert_eq!(redirect_host("javascript:alert(1)"), None);
        assert_eq!(redirect_host("claude.ai/cb"), None);
    }
}
