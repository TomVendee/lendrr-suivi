ALTER TABLE sessions ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days';
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
-- Nettoyage des sessions échues (lancé au boot et à chaque login).
DELETE FROM sessions WHERE expires_at <= now();
