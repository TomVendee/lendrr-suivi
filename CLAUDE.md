# Suivi projet (LENDRR) — instructions pour Claude Code

App web de suivi de planning pour l'équipe du projet EPITA SIGL « casier connecté LENDRR » (6 personnes).
Elle **remplace Asana** : tâches, dépendances avec décalage automatique, heures prévues et réelles, plan de
charge, alertes, Gantt avec chemin critique, météo par axe, synthèse hebdo et export pour la soutenance.
Déployée sur **Cassiopée**, la plateforme Kubernetes en libre-service de l'EPITA.

Le développeur est Tom A. (chef de projet de l'équipe). Il écrit en français ; réponds-lui en français.

## À lire avant tout travail

1. `docs/cahier-des-besoins.md` : le besoin, les 11 fonctions dans l'ordre, les règles de calcul et d'alerte.
2. `docs/decisions.md` : la stack et les choix tranchés (D1 à D17), les risques acceptés, les points ouverts.
3. `docs/maquettes/README.md` puis le `.dc.html` de l'écran concerné : rendu et comportement attendus.
4. `docs/cassiopee-guide-ia.md` : **avant toute action de déploiement**. Il fait foi sur Cassiopée.

## Stack (voir `docs/decisions.md`)

Rust côté serveur (Axum + tokio + sqlx, validation serde + validator), React + Vite +
TanStack Query côté front, PostgreSQL 16 via sqlx (migrations versionnées appliquées au
démarrage), `cargo test` pour les tests, Playwright pour quelques parcours de bout en bout.
Une seule image Docker (build `rust:1.90-slim`, run `debian:12-slim`, utilisateur `appuser`
UID 1000, port 8080) qui sert l'API sous `/api`, le MCP sous `/mcp` et le front. Postgres
local via `docker compose` pour le développement.

Arborescence visée (à créer, ajustable si tu justifies) :

```
src/domain/     logique métier pure, sans I/O : jours ouvrés, charge, décalage, chemin critique, alertes, validation
src/routes/     Axum : routes /api, /mcp, auth, accès base (sqlx), migrations, /health, /ready
src/auth.rs     argon2id, sessions, tokens API
src/config.rs   env (DATABASE_URL, PORT, APP_URL, SETUP_CODE temporaire)
src/web.rs      sert web/dist (build Vite) sinon page hello du socle
web/            React : écrans, composants, jetons de design (Vite, outDir dist)
db/migrations/  migrations sqlx
deploy/         Dockerfile, corps JSON Cassiopée SANS secret, script de déploiement
docs/           cahier, décisions, maquettes, guide Cassiopée, contrat MCP (ne pas modifier sans accord, sauf decisions.md)
```

Nommage : code et identifiants en anglais, interface en français, dates affichées `jj/mm`, heures `1,5 h`.

## Modèle de données (points qui comptent)

- **User** : nom, e-mail, rôle `member` ou `pilot` (chef de projet), capacité par défaut (4 h).
- **CapacityOverride** : capacité d'une personne pour une semaine (absence = 0 h).
- **Axis** : HARD, SOFT, IA, PILOTAGE, VIDÉO (modifiables).
- **Task** : titre, axe, début, fin, statut (`todo`, `in_progress`, `blocked`, `done`), critère « Terminé
  quand », jalon oui/non. Un jalon a une date unique et **ne bouge jamais seul**.
- **Assignment** : tâche × personne, rôle `lead` (pilote de la tâche) ou `support` (appui), heures prévues.
  **Exactement un `lead` par tâche validée.**
- **Dependency** : fin-début, prédécesseur → successeur. Pas de cycle (le refuser à l'écriture).
- **TimeEntry** : heures réelles d'une personne sur une tâche pour une semaine.
- **Validation (fonction 11, prévue dès la fonction 1)** : une tâche a une version **publiée** (celle que voient
  les collaborateurs et qui compte dans les calculs) et éventuellement une version **en attente** (proposée par
  un membre, ou modification de dates, d'heures ou de collaborateurs). Une table de révisions par tâche
  convient. Les **décalages automatiques modifient directement la version publiée**, sans validation.
- **Baseline** : photo du planning publiée chaque lundi (dates et heures prévues). Le « prévu » des écarts et
  de l'export se lit dans la baseline de la semaine, pas dans le planning courant.
- **Settings** : validation active, revalidation après modification, qui peut proposer, validateur et
  suppléant, délai de rappel, seuils d'alerte, date de début du projet (S01 = lundi 24/08/2026).

## Règles métier à tester en priorité (`src/domain/`, `cargo test`)

Chacune avec des cas tirés du vrai planning (cahier, maquettes) et des cas limites :

1. Jours ouvrés lundi-vendredi, fuseau Europe/Paris, numéro de semaine projet.
2. Charge prévue d'une personne par semaine : somme de ses heures (lead et support), une tâche sur plusieurs
   semaines répartie **au prorata de ses jours ouvrés**.
3. Décalage automatique : quand la fin d'une tâche recule, un successeur recule **seulement s'il chevauche**
   désormais, en jours ouvrés, en cascade ; durée conservée ; les jalons ne bougent pas et lèvent « jalon
   menacé ».
4. Chemin critique (CPM fin-début, jours ouvrés) : marges, tâches sans marge.
5. Les sept alertes du tableau du cahier, avec leurs seuils réglables.
6. Validation : visibilité selon l'état, ancienne version en vigueur pendant une modification, refus de valider
   sans exactement un `lead`.

## Méthode de travail

- **Une fonction du cahier à la fois, dans l'ordre 1 → 11.** Commence par le socle (projet, base, auth, page
  `/setup`, déploiement « hello » sur Cassiopée) avant la fonction 1, pour que chaque fonction soit livrable.
- Pour chaque fonction : propose d'abord un plan court (données, routes, écrans, tests) et **attends l'accord
  de Tom A.** ; puis tests du domaine, puis API, puis écran d'après la maquette.
- **Terminé** = tests verts (`cargo test`), clippy et types sans erreur, l'écran correspond à la maquette sur
  ordinateur et à 390 px de large, et la fonction a été essayée en local avec des données réalistes.
- Petits commits clairs. N'ajoute rien du « Hors V1 » sans qu'on le demande.
- Si une règle du cahier est ambiguë, pose la question au lieu d'inventer ; note la réponse dans
  `docs/decisions.md`.

## Déploiement sur Cassiopée

Lire `docs/cassiopee-guide-ia.md` en entier d'abord. Points non négociables :

- **Le jeton Keycloak vient de Tom A.** : ne le demande jamais dans le chat, ne l'écris dans aucun fichier du
  dépôt, ne le passe pas en argument. Le script de déploiement le lit dans un fichier **hors dépôt** dont le
  chemin est donné par la variable `CASSIOPEE_TOKEN_FILE`, écrit un fichier de config `curl` temporaire
  (`--config`, permissions 600) et le supprime après.
- **Avant tout `POST`, `PUT`, `DELETE` ou `suspend`** : lire `GET /quota`, dire exactement ce qui va être créé
  ou modifié, **attendre l'accord explicite** de Tom A. Ne jamais supprimer la base.
- Après chaque écriture : sonder `/status` jusqu'à `deployed`, puis `curl -I` sur l'URL. Un `202` n'est pas un
  déploiement réussi.
- Noms (décision D12) : base `iplanner-db` (PostgreSQL 16, `db_name` `app`), application `iplanner`,
  endpoint `iplanner`. Tout en minuscules.
- Application : image publique `ghcr.io/<compte>/lendrr-suivi:<version>` (jamais `latest`), `service`
  `{"port": 80, "target_port": 8080}`, sonde readiness `/ready` sur 8080, limites à valider avec `/quota`.
  Après le `POST`, relire avec `GET` : si `service` est `null`, le renvoyer en `PUT` (écart connu).
- `env` est stocké **en clair** chez Cassiopée et chaque `PUT` le remplace en entier : n'y mettre que
  `DATABASE_URL`, `NODE_ENV`, `PORT`, `APP_URL` et, temporairement, `SETUP_CODE`. Les valeurs secrètes sont lues
  dans un fichier local hors dépôt (`LENDRR_ENV_FILE`) au moment du déploiement, jamais commitées.
- La chaîne de connexion de la base n'est montrée **qu'une fois**, à la création : demande à Tom A. de la
  ranger dans son fichier hors dépôt, ne l'affiche pas une seconde fois et ne la journalise pas.
- Le pipeline GitHub Actions build et publie l'image ; le déploiement sur Cassiopée reste une action
  manuelle lancée par Tom A. (le jeton n'est pas mis dans GitHub).

## Import Asana (fonction 4)

Définis le format d'import dans `docs/import-format.md` (JSON : axes, personnes, tâches avec dates, statut,
critère, collaborateurs et heures, dépendances, jalons). Tom A. fera produire le fichier à partir du projet
Asana « MVP Casier IoT · v2 (axes) » (81 tâches, 78 dépendances) par Claude dans Cowork, qui a accès à Asana.
L'import doit être rejouable sans créer de doublons et produire un rapport (créé, ignoré, en erreur).

## Sécurité

- Jamais de secret dans le dépôt, les commits, les journaux ou les URL (`.gitignore` fourni).
- Mots de passe en argon2id, cookies de session `HttpOnly; Secure; SameSite=Lax`, contrôle du rôle côté
  serveur sur chaque route d'écriture, entrées validées par serde + validator.
- `/setup` ne fonctionne que tant qu'aucun utilisateur n'existe, et exige `SETUP_CODE`.
