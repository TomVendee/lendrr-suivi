# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Suivi projet (LENDRR) — instructions pour Claude Code

App web de suivi de planning pour l'équipe du projet EPITA SIGL « casier connecté LENDRR » (6 personnes).
Elle **remplace Asana** : tâches, dépendances avec décalage automatique, heures prévues et réelles, plan de
charge, alertes, Gantt avec chemin critique, météo par axe, synthèse hebdo et export pour la soutenance.
Déployée sur **Coolify** (`coolify.myth2logics.dev`, projet IPV6-SIGL › production) : `https://planning.ipv6-sigl.fr`.

Le développeur est Tom A. (chef de projet de l'équipe). Il écrit en français ; réponds-lui en français.

## À lire avant tout travail

1. `docs/cahier-des-besoins.md` : le besoin, les 11 fonctions dans l'ordre, les règles de calcul et d'alerte.
2. `docs/decisions.md` : la stack et les choix tranchés (D1 à D20), les risques acceptés, les points ouverts.
3. `docs/maquettes/README.md` puis le `.dc.html` de l'écran concerné : structure, contenu et comportement
   attendus. Le visuel suit la DA « Précision » (D23), pas les maquettes.
4. `docs/cassiopee-guide-ia.md` : **obsolète** (Cassiopée abandonnée, voir `decisions.md` D1).
5. `docs/mcp.md` (contrat MCP, D18) et `docs/import-format.md` (format d'import) si on touche à ces parties.

`docs/` ne se modifie pas sans accord, sauf `decisions.md`.

## Stack (voir `docs/decisions.md`)

Rust côté serveur (Axum + tokio + sqlx, validation serde + validator, MCP via `rmcp`), React 19 + Vite +
TanStack Query + Mantine 9 côté front, PostgreSQL 16 via sqlx (migrations versionnées appliquées au
démarrage), `cargo test` pour les tests. Une seule image Docker (`Dockerfile` à la racine : build
`rust:1.90-slim` + `node:22-alpine`, run `debian:12-slim`, UID 1000, port 8080) qui sert l'API sous `/api`,
le MCP sous `/mcp` et le front. Postgres local via `docker compose`.

## Commandes

```bash
docker compose up -d db                 # Postgres 16 local (postgres/postgres, base app)
cargo run                               # depuis la racine ; migrations appliquées au démarrage, :8080
cargo test                              # tests du domaine (pas besoin de base)
cargo test shift::                      # un module ; `cargo test nom_du_test` pour un seul
cargo clippy --all-targets
cd web && npm install && npm run dev    # :5173, proxy /api et /health vers :8080
cd web && npm run build                 # tsc --noEmit + vite build → web/dist servi par le binaire
docker compose up --build               # image complète + base
```

Premier compte en local : `POST /setup` avec `SETUP_CODE=change-moi` (`.env.example`). `/setup` et `/mcp`
ne passent pas par le proxy Vite : les appeler directement sur `:8080`.

## Architecture réelle

- `src/main.rs` : config → pool (5 connexions) → `sqlx::migrate!("./db/migrations")` → `routes::router`.
- `src/routes/mod.rs` : `AppState`, table de routage complète (`build()`), lecture du cookie `sid` et du
  `Bearer`. Un module par ressource. État construit depuis `Config` (`src/config.rs`). Aucun test d'API.
- `src/mcp.rs` : serveur `rmcp` stateless sous `/mcp`, mêmes règles et rôles que la REST.
- `src/domain/` : fonctions pures testées ; les routes y délèguent les calculs.
- `src/routes/settings.rs` : réglages du pilote (ligne unique `settings`), lus par `settings::load` dans les
  écritures de tâches (`write_mode`), la file de validation (`can_decide`) et les alertes (seuils, rappel).
- `src/web.rs` : lit `web/dist` **relativement au dossier courant** (lancer depuis la racine), fallback SPA
  vers `index.html`, page « socle OK » si le front n'est pas construit ; `/api/*`, `/mcp`, `/health`,
  `/ready` inconnus → 404.
- `web/src/api.ts` : client `fetch`, types partagés, formats `jj/mm` et heures. Un écran par fichier dans
  `web/src/views/`, choisi par l'URL (`web/src/router.ts` : `/meteo`, `/taches/:id`…, transitions natives).
- Couleurs, rayons, ombres et durées : **uniquement** les variables de `web/src/styles/tokens.css` (clair et
  sombre via `light-dark()`), jamais de hex dans les écrans. `web/src/theme.tsx` garde des alias historiques
  (`C.*`, `muted`…) qui pointent vers ces variables ; `.inverse` force un bloc en sombre.
- Navigation : `web/src/nav.tsx` est la source unique des écrans (libellé, icône, raccourci « g + lettre »),
  utilisée par la barre latérale, la barre du bas mobile et la palette ⌘K (`CommandPalette.tsx`,
  `@mantine/spotlight`). `Sheet` (`Shell.tsx`) = fenêtre sur ordinateur, feuille du bas sur téléphone.
- Écritures fréquentes optimistes (`setQueryData` puis annulation si erreur), `toastUndo`/`CountUp` dans
  `web/src/motion.tsx`, squelettes par écran dans `web/src/skeletons.tsx`. Couleurs d'axe : `AXES` (`theme.tsx`).
- Requêtes sqlx **à l'exécution** (`query` / `query_as`), pas de macros `query!` (D4 : build Docker en
  `SQLX_OFFLINE` sans `.sqlx/`).
- Cookie `Secure` désactivé si `APP_URL` commence par `http://` (dev local uniquement).
- CI (`.github/workflows/image.yml`) : chaque push sur `main` lance `cargo test --locked` puis publie
  `ghcr.io/<repo>:sha-xxxxxxx` (ou le tag `v*`). Ni clippy ni `tsc` hors du build Docker.

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
- Autres tables : `sessions`, `api_tokens` (hash SHA-256, révocables, D18), `task_comments`, `app_snapshots`
  (JSONB, D19). Révisions validées/rejetées purgées après 90 j ; `time_entries` et `baselines` jamais (D20).

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
  `/setup`, déploiement « hello » sur Coolify) avant la fonction 1, pour que chaque fonction soit livrable.
- Pour chaque fonction : propose d'abord un plan court (données, routes, écrans, tests) et **attends l'accord
  de Tom A.** ; puis tests du domaine, puis API, puis écran d'après la maquette.
- **Terminé** = tests verts (`cargo test`), clippy et types sans erreur, l'écran reprend la structure et le
  contenu de la maquette dans la DA « Précision » (D23), en clair et en sombre, sur ordinateur et à 390 px de
  large, utilisable au clavier, et la fonction a été essayée en local avec des données réalistes.
- Petits commits clairs. N'ajoute rien du « Hors V1 » sans qu'on le demande.
- Si une règle du cahier est ambiguë, pose la question au lieu d'inventer ; note la réponse dans
  `docs/decisions.md`.

## Déploiement sur Coolify

Application `planning` (projet IPV6-SIGL › production), base `planning-db` (PostgreSQL 16, base `app`). Image publique
`ghcr.io/tomvendee/lendrr-suivi` publiée par la CI (`.github/workflows/image.yml`) : tag immuable `sha-xxxxxxx` à
chaque push, plus le tag mobile `main` sur la branche principale. Port 8080, domaine `https://planning.ipv6-sigl.fr`,
pas de healthcheck Coolify (l'image n'a ni `curl` ni `wget`). Variables : `DATABASE_URL`, `PORT=8080`,
`APP_URL=https://planning.ipv6-sigl.fr` (+ `SETUP_CODE` le temps du premier compte, puis retiré).
Ne jamais supprimer la base.

- **CD (D25)** : à chaque push sur `main`, la CI teste, publie l'image, appelle l'API de déploiement de Coolify
  (secret GitHub `COOLIFY_TOKEN`, jeton limité au déploiement) puis attend que `GET /api/hello` renvoie le `sha` du
  commit. Sans le secret, l'étape est ignorée et le déploiement reste manuel. Coolify doit suivre le tag `main`.
- **Manuel / rollback** : dans Coolify, mettre le tag de l'image sur un `sha-xxxxxxx` précis et redéployer ; la CD
  suivante le remettra sur `main` si on y retourne.
- Aucun jeton dans le dépôt, les journaux ou le chat. Le jeton Coolify est créé par l'administrateur de l'instance.

## Import Asana (fonction 4)

Format défini dans `docs/import-format.md` (JSON : axes, personnes, tâches avec dates, statut, critère,
collaborateurs et heures, dépendances, jalons), route `POST /api/import`. Tom A. fait produire le fichier à partir du projet
Asana « MVP Casier IoT · v2 (axes) » (81 tâches, 78 dépendances) par Claude dans Cowork, qui a accès à Asana.
L'import doit être rejouable sans créer de doublons et produire un rapport (créé, ignoré, en erreur).

## Sécurité

- Jamais de secret dans le dépôt, les commits, les journaux ou les URL (`.gitignore` fourni).
- Mots de passe en argon2id, cookies de session `HttpOnly; Secure; SameSite=Lax` (`Secure` seulement hors dev http), contrôle du rôle côté
  serveur sur chaque route d'écriture, entrées validées par serde + validator.
- `/setup` ne fonctionne que tant qu'aucun utilisateur n'existe, et exige `SETUP_CODE`.
