# Format d'import Asana (fonction 4)

Tom A. fait produire ce fichier par Claude dans Cowork (accès Asana) depuis le projet
« MVP Casier IoT · v2 (axes) » (81 tâches, 78 dépendances). L'import est **rejouable** :
relancé deux fois, il ne crée aucun doublon (`external_key` = gid Asana).

```jsonc
{
  "tasks": [
    {
      "key": "asana-gid-123",            // stable, unique. Re-import = mise à jour, pas doublon
      "title": "Câbler le casier",
      "axis": "HARD",                    // HARD | SOFT | IA | PILOTAGE | VIDEO
      "start": "2026-10-19",             // jj aaaa-mm-jj ; jalon : start == end
      "end": "2026-10-23",
      "status": "todo",                  // todo | in_progress | blocked | done
      "criteria": "Le casier s'ouvre",   // « Terminé quand », peut être vide
      "milestone": false,
      "assignees": [
        {"email": "tom@example.com", "role": "lead", "hours": 4.0}
      ],                                 // exactement 1 lead, e-mails déjà connus de l'app
      "depends_on": ["asana-gid-456"]    // clés du même fichier, pas de cycle
    }
  ]
}
```

Règles :
- E-mail inconnu → tâche **en erreur** (les comptes sont créés par le pilote, jamais par l'import).
- Axe inconnu, dates inversées, statut inconnu → **en erreur**, le reste passe.
- Dépendance vers une clé absente ou qui formerait un cycle → dépendance **ignorée et signalée**.
- `POST /api/import` (pilote) répond `{created, updated, skipped, errors: [{key, reason}]}`.
