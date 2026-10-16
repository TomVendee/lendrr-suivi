-- Nom donné à un token d'accès IA, pour les distinguer dans la liste.
ALTER TABLE api_tokens ADD COLUMN label TEXT NOT NULL DEFAULT '';
