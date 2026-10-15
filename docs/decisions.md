# Décisions techniques

État au 15/10/2026. Une décision « tranchée » ne se rediscute qu'avec Tom A. ; une décision « ouverte » a une
valeur par défaut à appliquer tant que rien d'autre n'est décidé.

## Tranchées

| # | Sujet | Décision | Pourquoi |
| --- | --- | --- | --- |
| D1 | Hébergement | **Cassiopée (prod SiOps)**, voir `cassiopee-guide-ia.md` | Contrainte du projet. Gratuit, HTTPS fourni, Postgres managé. |
| D2 | Forme du déploiement | **Une seule image Docker** : le serveur Rust sert l'API (`/api/*`), le MCP (`/mcp`) et les fichiers du front. Une Application `Deployment`, un Endpoint, une base. | Moins de ressources consommées sur le quota, un seul endpoint, pas de CORS. |
| D3 | Langage | **Rust (serveur) + TypeScript (front React)**. | Rust : binaire ~20 Mo, mémoire divisée, pas de churn npm côté serveur ; React gardé pour les maquettes et la maintenance. Choix de Tom A., assumé. |
| D4 | Serveur | **Axum + tokio + sqlx**, validation des entrées avec **serde + validator**. Requêtes sqlx **à l'exécution** (`query` / `query_as`), pas de macros `query!` : le build Docker tourne en `SQLX_OFFLINE=true` sans dossier `.sqlx/`. | Léger (~50 Mo, limite 256Mi large), simple ; pas de base nécessaire au build (CI, Docker). Passer aux macros imposerait `cargo sqlx prepare` et de committer `.sqlx/`. |
| D5 | Front | **React + Vite** (SPA), **TanStack Query** pour les données, **Mantine 9** (composants, dates, formulaires, notifications, `@mantine/charts` sur recharts) + `@tabler/icons-react`. Jetons des maquettes dans `web/src/theme.tsx`, mappés sur Mantine dans `web/src/mantine-theme.ts`. Gantt dessiné à la main en SVG/React. | Écosystème le mieux connu de Claude Code ; Mantine apporte dark mode, toasts, sélecteurs de dates et graphes sans tout réécrire, ce que le CSS simple initial ne couvrait pas (commit `ca25692`). |
| D6 | Base | **PostgreSQL 16** sur Cassiopée (`storage_size` 1Gi, à ajuster selon `/quota`), **sqlx** + migrations versionnées, appliquées au démarrage du serveur. Colonnes d'heures en `DOUBLE PRECISION`. | Base managée et persistante ; les migrations au démarrage évitent tout accès manuel au cluster. |
| D7 | Logique métier | Fonctions **pures** dans `src/domain/` (jours ouvrés, charge, décalage, chemin critique, alertes, validation), testées avec **`cargo test`**. | Ce sont les règles qui comptent pour la soutenance ; elles doivent être justes et prouvées. |
| D8 | Connexion | **E-mail + mot de passe** (argon2id), sessions en cookie `HttpOnly; Secure; SameSite=Lax` stockées en base. Comptes créés par le chef de projet. | Pas de SMTP pour un lien magique, pas de client OAuth Google à enregistrer. 6 utilisateurs. |
| D9 | Premier compte | Page `/setup` active **seulement tant qu'aucun utilisateur n'existe**, protégée par un code `SETUP_CODE` passé en variable d'environnement, retirée après usage. | Cassiopée ne donne aucun accès shell au pod : impossible de lancer une commande de création d'admin. |
| D10 | Images | Construites par **GitHub Actions**, publiées sur **ghcr.io en paquet public**, tag = version ou SHA court, **jamais `latest`**. | Cassiopée n'accepte que des images publiques déjà construites. |
| D11 | Conteneur | Build `rust:1.90-slim`, run `debian:12-slim`, utilisateur `appuser` (UID 1000), écoute sur **8080**, sondes `/health` (vivant) et `/ready` (base joignable). | Règles non-root et port > 1024 de Cassiopée. |
| D12 | Noms Cassiopée | Base `iplanner-db` (hôte interne `iplanner-db-postgresql`), application `iplanner`, endpoint `iplanner` → `https://iplanner.cassiopee.siops.sigl.epita.fr`. | Noms courts sans tiret (les noms avec `-` restaient bloqués en `provisioning`, 13/10/2026) ; tout en minuscules. |
| D13 | Mode de décalage | **Seulement en cas de chevauchement**, en jours ouvrés. Les jalons ne bougent jamais seuls. | Déjà fixé dans le cahier. |
| D14 | Mise à jour | **Pas de temps réel en V1** : rechargement des données au retour sur l'onglet et toutes les 60 s (TanStack Query). | Simplicité ; 6 utilisateurs. |
| D15 | Synthèse hebdo | **Texte à trous** rempli par l'app, que le chef de projet relit. Pas de clé d'API d'IA en V1. | Gratuit, pas de secret à stocker. |
| D16 | Langue et temps | Interface en **français**, fuseau **Europe/Paris**, semaines du lundi au vendredi, numérotées depuis le début du projet (S06 = semaine du 28/09/2026, donc S01 = 24/08/2026), réglable. | Usage de l'équipe. |
| D17 | Direction artistique | **Neutre et réutilisable** : nom « Suivi projet », le projet (LENDRR) n'est qu'une donnée. Jetons dans `docs/maquettes/README.md`. | Demande du chef de projet. |
| D18 | Accès IA / MCP | **MCP plein accès** (`POST /mcp`, Streamable HTTP `rmcp` stateless), mêmes règles et rôles que la REST, contrat dans `docs/mcp.md`. Implémenté après F5. Tokens personnels `api_tokens` (hash SHA-256, révocables). | Pilotage par les IA comme Linear, sans clé d'IA externe (D15 intacte). |
| D19 | Stockage croissant | **Tout en Postgres** : `baselines` + `app_snapshots` (JSONB) en base, pas de S3 en V1. < 50 Mo/an estimés, 1Gi tient des années. | S3 503 au 09/10 ; les baselines hebdo sont la référence du prévu. |
| D20 | Purge | `task_revisions` validées/rejetées purgées après **90 j** ; `time_entries` et `baselines` jamais purgés. | Place + traçabilité soutenance. |
| D21 | Début du projet | **Fixe : S01 = lundi 24/08/2026**, non modifiable dans Réglages (colonne `settings.project_start` ignorée). | Les numéros de semaine sont stockés dans `time_entries`, `capacity_overrides` et `baselines` : changer la date de départ les fausserait tous. |
| D22 | Validateurs | Validateur vide = le pilote. Le **pilote, le validateur désigné et le suppléant** peuvent tous valider, **à tout moment** (pas de notion d'absence). Rappel après N jours ouvrés (`reminder_days`, 2 par défaut) affiché comme alerte « Validation en attente », sans notification. Mode « total à parts égales » : aide de saisie côté formulaire, arrondi à 0,1 h, sans effet sur les calculs. | Choix de Tom A. (15/10/2026) ; notifications hors V1. |
| D23 | Direction artistique « Précision » | **Nouvelle DA, qui remplace la partie visuelle de D17 et des maquettes** : esprit Linear, thème sombre et clair (le système choisit par défaut), Geist / Geist Mono, accent indigo unique, densité élevée. Jetons uniques dans `web/src/styles/tokens.css` (oklch, `light-dark()`), aucune couleur en dur dans les écrans. Couleurs des axes : palette catégorielle validée (outil dataviz, clair et sombre). Les maquettes restent la référence de **structure et de contenu**, plus du visuel. Routage par URL (`web/src/router.ts`, API History + View Transitions). | Demande de Tom A. (15/10/2026) : une app moderne, qui marque le jury et soit agréable au quotidien. |
| D24 | Automatismes | Tâche de fond horaire dans le serveur (`routes::report::housekeeping`) : photo de la semaine (baseline + sauvegarde JSON) **dès qu’elle manque et que le planning n’est pas vide**, donc le lundi à 0 h, ou au redémarrage si le serveur était arrêté ; le bouton du pilote la reprend à la demande. Purge D20 sur la **date de proposition** (pas de date de décision en base), jamais les propositions en attente. | Pas de CronJob ni d'accès au cluster nécessaires ; un seul réplica sur Cassiopée, donc pas de double exécution. |

## Risques acceptés

- **Mot de passe de la base dans `env`.** Cassiopée stocke `env` en clair dans son dépôt Git et ne permet pas
  (via l'API) de monter le secret Kubernetes de la base. `DATABASE_URL` y figurera donc. Atténuation : la base
  n'est joignable que depuis le namespace ; en cas de fuite, `POST /databases/{name}/rotate-password` puis
  `PUT` de l'application. **Aucun autre secret durable** ne doit aller dans `env`.
- **`SETUP_CODE` en clair** le temps de créer le premier compte : retirer la variable par un `PUT` juste après.

## Ouvertes (avec valeur par défaut)

| Sujet | Défaut à appliquer | Ce qui ferait changer |
| --- | --- | --- |
| Sauvegarde quotidienne | En V1 : export JSON complet téléchargeable par le chef de projet (Réglages › Sauvegardes) et rappel dans la synthèse du lundi. Plus tard : `CronJob` Cassiopée qui fait un `pg_dump` vers un bucket S3. | S3 répondait 503 au 09/10/2026 : tester `GET /s3` avant de l'utiliser. |
| Limites CPU/mémoire | `200m` / `256Mi` pour l'application. | Lire `GET /quota` avant le premier déploiement. |
| Notifications | Aucune en V1 (hors périmètre). | Après la bascule, si les rappels dans l'app ne suffisent pas. |
| Connexion via Keycloak EPITA | Non en V1. | Si un client OIDC peut être obtenu pour l'app. |
| Incident Cinder 13/10 | Tout ce qui monte un volume (bases managées, apps avec `/ready` sur DB) reste à `0/1` sur prod comme staging ; Endpoint/CronJob/apps sans DB passent. Ressources `iplanner*` supprimées des deux envs pour libérer les quotas, à recréer après réparation. | Retour SiOps (piste : OpenStack/Cinder HS, même famille que S3 503 du 09/10). |
