-- Socle : utilisateurs, sessions, tokens API, axes, tâches, assignations,
-- dépendances, heures, révisions, baselines, snapshots, réglages.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','pilot')),
  default_capacity_hours DOUBLE PRECISION NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CITEXT requiert l'extension citext ; repli TEXT si indisponible :
-- (si CREATE EXTENSION citext échoue, remplacer CITEXT par TEXT ci-dessus)

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'full',
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE axes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
INSERT INTO axes (code, label) VALUES
  ('HARD','Hard'), ('SOFT','Soft'), ('IA','IA'),
  ('PILOTAGE','Pilotage'), ('VIDEO','Vidéo');

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  axis_code TEXT NOT NULL REFERENCES axes(code),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done')),
  done_criteria TEXT NOT NULL DEFAULT '',
  milestone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE assignments (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('lead','support')),
  planned_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE dependencies (
  pred_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  succ_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (pred_id, succ_id),
  CHECK (pred_id <> succ_id)
);

CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week INT NOT NULL,
  hours DOUBLE PRECISION NOT NULL CHECK (hours >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id, week)
);

CREATE TABLE task_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = proposition de tâche nouvelle (naît à la validation, F11)
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','validated','rejected')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE capacity_overrides (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week INT NOT NULL,
  hours DOUBLE PRECISION NOT NULL CHECK (hours >= 0),
  PRIMARY KEY (user_id, week)
);

CREATE TABLE baselines (
  week INT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_snapshots (
  week INT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  validation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  project_start DATE NOT NULL DEFAULT DATE '2026-08-24',
  CHECK (id = 1)
);
INSERT INTO settings (id) VALUES (1);
