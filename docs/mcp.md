# Accès IA / MCP (D18)

## Principe

Les IA (Claude, Cowork, IDE) pilotent l'app comme Linear : elles lisent le planning
et remplissent de la donnée via le protocole **MCP**, avec **le même contrôle de rôle que la REST** :
un token de membre ne peut pas valider, un token pilote peut tout. Chaque outil appelle les mêmes
règles que l'écran correspondant.

Pas de clé d'API d'IA côté serveur (D15 intacte) : le MCP expose *nos* données aux IA
*externes*, il n'appelle aucune IA.

## Transport

- `POST https://planning.ipv6-sigl.fr/mcp` (et `/mcp/`), protocole **Streamable HTTP** (`rmcp`,
  `legacy_session_mode = false`, mode **stateless** : aucune session en mémoire, compatible redémarrages).
- Servi par la même application que l'API et le front : un seul domaine.
- Protection contre le DNS-rebinding de `rmcp` : les `Host` acceptés sont `localhost`, `127.0.0.1`, `::1`
  et l'hôte de `APP_URL`. Tout autre `Host` reçoit `403`.
- État au 20/10/2026 : **en service**, 8 outils (tableau ci-dessous).

## Authentification

- **Toutes** les méthodes (`initialize`, `tools/list`, `tools/call`) exigent
  `Authorization: Bearer ls_<base64url, 32 octets>`. Sans token valide et non révoqué : `401` avec
  `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource/mcp"`
  (découverte OAuth, voir plus bas). Le cookie de session web n'est **pas** accepté sur `/mcp`.
- Un token est **personnel** : il agit au nom de son propriétaire, avec son rôle (`member` ou `pilot`).
- **Gestion dans l'interface** : menu du compte › **Accès IA**. Chacun crée (avec un nom, par exemple
  « Claude Code »), liste et révoque ses propres tokens. La valeur n'est affichée qu'**une seule fois**,
  à la création.
- **Gestion par l'API** (session web ou token) : `POST /api/tokens` (corps facultatif `{"label": "…"}`,
  60 caractères max ; réponse `{id, token}`), `GET /api/tokens` (tokens actifs : `id`, `label`,
  `created_at`, jamais la valeur), `DELETE /api/tokens/{id}` (révocation immédiate).
- Stocké **hashé SHA-256** en base (`api_tokens`), révocable (`revoked`), scopes `full`
  (V1 : le rôle fait foi, pas de scopes fins).

## Connecteur OAuth (D27) : claude.ai, Cowork, application mobile

Ces clients n'envoient pas d'en-tête fixé à la main : ils découvrent le serveur d'autorisation et
obtiennent eux-mêmes un token. L'application est son propre serveur d'autorisation **OAuth 2.1** minimal :

| Route | Rôle |
|---|---|
| `GET /.well-known/oauth-protected-resource` (et `…/mcp`) | RFC 9728 : `resource` = `<APP_URL>/mcp`, serveur d'autorisation = `<APP_URL>` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 : points d'entrée, `code` + PKCE `S256`, clients publics (`none`) |
| `POST /oauth/register` | RFC 7591, sans authentification : `{redirect_uris, client_name}` → `{client_id}`. Redirections acceptées : `https://claude.ai/…`, `https://claude.com/…` et la boucle locale (`localhost`, `127.0.0.1`, `[::1]`, http ou https). Autre hôte : `invalid_redirect_uri`. 500 clients maximum. |
| `GET /oauth/authorize` | Page de consentement (hors SPA, interdite en iframe). Connecté : bouton « Autoriser ». Sinon : e-mail + mot de passe sur la même page. Client ou `redirect_uri` inconnus : page d'erreur, pas de redirection. |
| `POST /oauth/authorize` | Refus → `?error=access_denied&state=…` ; accord → `?code=…&state=…` (code à usage unique, 5 minutes, stocké hashé). |
| `POST /oauth/token` | `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` → `{access_token, token_type: "Bearer"}`. Erreur : `invalid_grant`. |

- Le token délivré est un **token `ls_…` ordinaire** (`api_tokens`, nommé d'après le client, par exemple
  « Claude ») : même rôle que la personne, listé et révocable dans *Accès IA*. Pas d'expiration ni de
  refresh token, comme les tokens créés à la main.
- Pas de scopes : le rôle fait foi (V1).
- **Ajout dans claude.ai** : Réglages › Connecteurs › Ajouter un connecteur personnalisé, URL
  `https://planning.ipv6-sigl.fr/mcp`, puis se connecter sur la page de consentement.

## Outils exposés

| Outil | Arguments | Qui | Effet |
|---|---|---|---|
| `my_week` | `week` (facultatif, défaut : semaine courante) | tout token | tâches de la semaine, charge prévue/réelle/capacité |
| `list_tasks` | `axis`, `status` (facultatifs) | tout token | tâches du planning, filtrables |
| `log_hours` | `task_id`, `week`, `hours` (0 à 80) | assigné à la tâche, ou pilote | heures réelles d'une semaine (remplace la valeur) |
| `update_task_status` | `task_id`, `status` : `todo`, `in_progress`, `blocked`, `done` | pilote du projet ou responsable (`lead`) de la tâche | change le statut ; pour un jalon, `done` = atteint |
| `add_task_comment` | `task_id`, `body` (non vide, 2000 caractères max) | tout token | poste dans le fil de discussion de la tâche ; le texte enregistré est précédé de `[IA] ` |
| `list_task_comments` | `task_id` | tout token | fil de discussion de la tâche, du plus ancien au plus récent : `author`, `body`, `at` ; à lire avant de commenter pour éviter les doublons |
| `list_alerts` | aucun | tout token | alertes (les siennes pour un membre, toutes pour le pilote) |
| `validate_task` | `revision_id`, `approve` | pilote, validateur ou suppléant (réglages) | valide ou rejette une révision en attente |

- Les erreurs reviennent en erreur JSON-RPC `-32602` avec la raison : `bad-status`, `bad-task-id`,
  `bad-task` (tâche inconnue), `not-found`, `lead-or-pilot-only`, `not-assigned`, `bad-hours`, `bad-comment`,
  `not-a-validator`, `bad-or-revoked-token`.
- **Signature des commentaires** : un commentaire posté par le MCP est signé du nom du propriétaire du
  token, sans marque qui indique qu'il vient d'une IA.
- Les identifiants de tâche (`task_id`) sont ceux renvoyés par `list_tasks` ou par l'API (`/api/tasks`).

### Prévus, pas encore exposés

`get_task`, `create_task` / `update_task` (pilote : publié direct ; membre : révision en attente),
`manage_dependencies` (pilote), `manage_assignments` (pilote), `list_load`, `gantt_data`, `meteo_data`,
`get_baseline` / `get_export` (pilote). La REST les offre déjà
pour la plupart ; ils arrivent dans le MCP avec leurs fonctions.

## Exemples

```bash
# Liste des outils (token obligatoire)
curl -s -X POST https://planning.ipv6-sigl.fr/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Poster un commentaire
curl -s -X POST https://planning.ipv6-sigl.fr/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_task_comment","arguments":{"task_id":"<uuid>","body":"Texte du commentaire"}}}'
```

Les réponses arrivent au format SSE (`data: {…}`) : retirer le préfixe `data: ` avant de lire le JSON.

Configuration client :

- **Claude Code** : `claude mcp add --transport http --scope user lendrr https://planning.ipv6-sigl.fr/mcp --header "Authorization: Bearer <token>"`
  (le token est alors écrit dans `~/.claude.json`, hors dépôt).
- **Autre client** : serveur MCP `streamable-http`, URL `https://planning.ipv6-sigl.fr/mcp`, en-tête `Authorization`.
  Un client qui ne sait pas envoyer d'en-tête personnalisé passe par l'OAuth ci-dessus.
- **Claude Code sans token collé** : `claude mcp add --transport http --scope user lendrr https://planning.ipv6-sigl.fr/mcp`,
  puis `/mcp` › Authenticate (redirection vers la boucle locale).
