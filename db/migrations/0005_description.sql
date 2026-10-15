-- Description libre d'une tâche (contexte, liens, consignes), en plus du critère « Terminé quand ».
ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT '';
