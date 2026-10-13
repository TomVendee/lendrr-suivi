# Accès IA / MCP (D18)

## Principe

Les IA (Claude, Cowork, IDE) pilotent l'app comme Linear : elles lisent le planning
et remplissent de la donnée via le protocole **MCP**, avec **plein accès fonctionnel**
mais **le même contrôle de rôle que la REST** : un token de membre ne peut pas valider,
un token pilote peut tout.

Pas de clé d'API d'IA côté serveur (D15 intacte) : le MCP expose *nos* données aux IA
*externes*, il n'appelle aucune IA.

## Transport

- `POST /mcp`, protocole **Streamable HTTP** (`rmcp`, `legacy_session_mode = false`,
  mode **stateless** : pas de `LocalSessionManager`, compatible répliques ≤ 3 et restarts).
- Monté sur la même Application/Endpoint Cassiopée (un seul endpoint, `path` transmis tel quel).
- En attendant l'implémentation (après F5) : `501 {"error":"mcp-not-ready"}`.

## Authentification

- `Authorization: Bearer ls_< base64url(32 octets) >`, token personnel créé par
  l'utilisateur (Réglages › Accès IA, ou route pilote en attendant l'écran).
- Stocké **hashé SHA-256** en base (`api_tokens`), révocable (`revoked`), scopes `full`
  (V1 : le rôle fait foi, pas de scopes fins).
- Le handler lit le header via `Extension<Parts>` et résout `(user_id, role)` comme la REST
  (cookie `sid` pour le web, Bearer pour machines/MCP).

## Outils (miroir de la REST, mêmes services, mêmes règles)

| Outil | Rôle min | Effet |
|---|---|---|
| `my_week` | member | tâches de ma semaine + charge prévue/réelle/capacité + mes alertes |
| `list_tasks` / `get_task` | member | liste filtrable (axe, statut), fiche complète |
| `create_task` / `update_task` | member* | pilote : publié direct ; membre : révision `pending` (202), validée en F11 |
| `update_task_status` | member | `todo/in_progress/blocked/done` |
| `manage_dependencies` | pilot | lier/délier (refus de cycle), décale en cascade |
| `manage_assignments` | pilot | lead/appuis + heures (exactement 1 lead) |
| `log_hours` | member | heures réelles d'une semaine |
| `list_load` | member | plan de charge personne × semaine |
| `list_alerts` | member (siennes) / pilot (toutes) | les 7 alertes |
| `gantt_data` | member | tâches + dépendances + chemin critique + jalons |
| `meteo_data` | member | avancement/retards/prochain jalon par axe |
| `validate_task` | pilot | valide/rejette une révision (F11) |
| `get_baseline` / `get_export` | pilot | photo du lundi, export prévu/réalisé |

\* `create_task` par un membre ne publie jamais directement (validation active par défaut).

## Exemples

```bash
# Santé MCP (501 tant que non implémenté)
curl -s -X POST https://lendrr-suivi.cassiopee.siops.sigl.epita.fr/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

Configuration client (Claude/Cowork) : serveur MCP `streamable-http`,
URL `https://lendrr-suivi.cassiopee.siops.sigl.epita.fr/mcp`, header `Authorization`.
