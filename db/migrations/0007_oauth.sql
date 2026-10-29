-- D27 : OAuth 2.1 du connecteur MCP (claude.ai, Cowork, mobile).
-- Clients enregistrés dynamiquement (RFC 7591), publics : pas de secret.
CREATE TABLE oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Codes d'autorisation : hash SHA-256, usage unique (supprimés à l'échange), 5 minutes.
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
