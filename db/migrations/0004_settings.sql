-- Réglages du pilote (maquette Réglages) : validation, validateur/suppléant, rappel,
-- mode de saisie des heures, seuils d'alerte. project_start reste fixe (D21).
ALTER TABLE settings
  ADD COLUMN revalidate_on_edit  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN members_can_propose BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN validator_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = le pilote
  ADD COLUMN deputy_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reminder_days INT DEFAULT 2 CHECK (reminder_days BETWEEN 1 AND 14), -- NULL = jamais
  ADD COLUMN hours_mode TEXT NOT NULL DEFAULT 'per_person' CHECK (hours_mode IN ('per_person', 'equal_split')),
  ADD COLUMN overrun_pct   DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  ADD COLUMN overrun_hours DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN blocking_days INT NOT NULL DEFAULT 7;
