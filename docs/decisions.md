# Décisions techniques

État au 15/10/2026. Une décision « tranchée » ne se rediscute qu'avec Tom A. ; une décision « ouverte » a une
valeur par défaut à appliquer tant que rien d'autre n'est décidé.

## Tranchées

| # | Sujet | Décision | Pourquoi |
| --- | --- | --- | --- |
| D1 | Hébergement | **Coolify** (`coolify.myth2logics.dev`, projet IPV6-SIGL › production), `https://planning.ipv6-sigl.fr`. Remplace Cassiopée (16/10/2026, suite à l'incident Cinder). | Cassiopée indisponible pour les apps avec base ; Coolify déjà utilisé par l'équipe. |
| D2 | Forme du déploiement | **Une seule image Docker** : le serveur Rust sert l'API (`/api/*`), le MCP (`/mcp`) et les fichiers du front. Une Application `Deployment`, un Endpoint, une base. | Moins de ressources consommées sur le quota, un seul endpoint, pas de CORS. |
| D3 | Langage | **Rust (serveur) + TypeScript (front React)**. | Rust : binaire ~20 Mo, mémoire divisée, pas de churn npm côté serveur ; React gardé pour les maquettes et la maintenance. Choix de Tom A., assumé. |
| D4 | Serveur | **Axum + tokio + sqlx**, validation des entrées avec **serde + validator**. Requêtes sqlx **à l'exécution** (`query` / `query_as`), pas de macros `query!` : le build Docker tourne en `SQLX_OFFLINE=true` sans dossier `.sqlx/`. | Léger (~50 Mo, limite 256Mi large), simple ; pas de base nécessaire au build (CI, Docker). Passer aux macros imposerait `cargo sqlx prepare` et de committer `.sqlx/`. |
| D5 | Front | **React + Vite** (SPA), **TanStack Query** pour les données, **Mantine 9** (composants, dates, formulaires, notifications, `@mantine/charts` sur recharts) + `@tabler/icons-react`. Jetons des maquettes dans `web/src/theme.tsx`, mappés sur Mantine dans `web/src/mantine-theme.ts`. Gantt dessiné à la main en SVG/React. | Écosystème le mieux connu de Claude Code ; Mantine apporte dark mode, toasts, sélecteurs de dates et graphes sans tout réécrire, ce que le CSS simple initial ne couvrait pas (commit `ca25692`). |
| D6 | Base | **PostgreSQL 16** (`postgres:16-alpine`) gérée par Coolify (`planning-db`, volume persistant), **sqlx** + migrations versionnées, appliquées au démarrage du serveur. Colonnes d'heures en `DOUBLE PRECISION`. | Base persistante ; les migrations au démarrage évitent tout accès manuel à la base. |
| D7 | Logique métier | Fonctions **pures** dans `src/domain/` (jours ouvrés, charge, décalage, chemin critique, alertes, validation), testées avec **`cargo test`**. | Ce sont les règles qui comptent pour la soutenance ; elles doivent être justes et prouvées. |
| D8 | Connexion | **E-mail + mot de passe** (argon2id), sessions en cookie `HttpOnly; Secure; SameSite=Lax` stockées en base. Comptes créés par le chef de projet. | Pas de SMTP pour un lien magique, pas de client OAuth Google à enregistrer. 6 utilisateurs. |
| D9 | Premier compte | Page `/setup` active **seulement tant qu'aucun utilisateur n'existe**, protégée par un code `SETUP_CODE` passé en variable d'environnement, retirée après usage. | L'image n'embarque aucun outil d'administration (pas de `curl`, pas de commande de création d'admin) : le premier compte se crée par l'API. |
| D10 | Images | Construites par **GitHub Actions**, publiées sur **ghcr.io en paquet public**, tag = version ou SHA court, **jamais `latest`** (sauf le tag mobile `main` prévu par D25, inactif). | Coolify tire une image publique déjà construite et testée ; le tag immuable permet de revenir en arrière. |
| D11 | Conteneur | Build `rust:1.90-slim`, run `debian:12-slim`, utilisateur `appuser` (UID 1000), écoute sur **8080**, sondes `/health` (vivant) et `/ready` (base joignable). | Bonnes pratiques (non-root, port > 1024), héritées des règles de Cassiopée. Pas de healthcheck Coolify : l'image n'a ni `curl` ni `wget` ; `/ready` sert aux vérifications à la main. |
| D12 | Noms | Base `planning-db` (PostgreSQL 16, `db_name` `app`), application `planning`, image `ghcr.io/tomvendee/lendrr-suivi`, domaine `planning.ipv6-sigl.fr`. | Remplace les noms Cassiopée `iplanner*`. |
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
| D24 | Automatismes | Tâche de fond horaire dans le serveur (`routes::report::housekeeping`) : photo de la semaine (baseline + sauvegarde JSON) **dès qu’elle manque et que le planning n’est pas vide**, donc le lundi à 0 h, ou au redémarrage si le serveur était arrêté ; le bouton du pilote la reprend à la demande. Purge D20 sur la **date de proposition** (pas de date de décision en base), jamais les propositions en attente. | Pas de CronJob ni d'accès au cluster nécessaires ; un seul réplica sur Coolify, donc pas de double exécution. |
| D25 | Déploiement continu (écrite, **inactive** : déploiement manuel tant que l'API Coolify n'est pas activée) | **CD GitHub Actions → Coolify** : après les tests et la publication de l'image, appel de `GET /api/v1/deploy` (jeton limité au déploiement, secret `COOLIFY_TOKEN`), puis attente que `/api/hello` renvoie le `sha` du commit. Coolify suit le tag mobile `main` ; le tag `sha-xxxxxxx` reste immuable pour le rollback. | Un jeton de déploiement ne peut pas changer la configuration (donc pas le tag) : d'où le tag mobile, qui déroge à D10 (« jamais `latest` ») pour la seule prod. Le `sha` renvoyé par `/api/hello` prouve que le bon commit tourne. |
| D26 | Commentaires écrits par une IA | Le MCP peut **poster** (`add_task_comment`) et **lire** (`list_task_comments`) le fil d'une tâche. Un commentaire posté par le MCP est enregistré avec le préfixe **`[IA] `**, sous le nom du propriétaire du token. | La personne voit tout de suite ce qui vient d'une IA ; lire le fil avant de poster évite les doublons. La marque est dans le texte (pas de colonne en plus) : simple, et visible partout où le commentaire s'affiche. |

## Risques acceptés

- **Mot de passe de la base dans les variables de l'application.** Coolify stocke les variables d'environnement de
  l'application, lisibles par les administrateurs de l'instance (partagée avec d'autres projets de l'équipe).
  `DATABASE_URL` y figure donc. Atténuation : la base n'est joignable que depuis le réseau interne de Coolify ;
  en cas de fuite, changer le mot de passe de `planning-db` dans Coolify puis mettre à jour `DATABASE_URL`.
  **Aucun autre secret durable** ne doit aller dans les variables.
- **`SETUP_CODE` en clair** le temps de créer le premier compte : supprimer la variable juste après (fait le 16/10/2026).
- **Un token d'accès IA peut en créer d'autres** (`POST /api/tokens` accepte un `Bearer`) : un token volé peut se
  dupliquer. Il suffirait d'exiger la session web pour la création si le risque devient gênant.
- **Un push sur `main` n'est pas déployé tout seul** (D25 inactive) : le déploiement reste une action manuelle.

## Ouvertes (avec valeur par défaut)

| Sujet | Défaut à appliquer | Ce qui ferait changer |
| --- | --- | --- |
| Sauvegarde quotidienne | En V1 : export JSON complet téléchargeable par le chef de projet (Réglages › Sauvegardes) et rappel dans la synthèse du lundi. À étudier : sauvegardes planifiées de `planning-db` dans Coolify. | Une perte de données, ou la décision d'ajouter une sauvegarde hors serveur. |
| Notifications | Aucune en V1 (hors périmètre). | Après la bascule, si les rappels dans l'app ne suffisent pas. |
| Connexion via Keycloak EPITA | Non en V1. | Si un client OIDC peut être obtenu pour l'app. |
| Déploiement continu (D25) | Manuel. | L'activation de l'API de Coolify par l'administrateur de l'instance et la création du secret `COOLIFY_TOKEN`. |

## Import Asana du 16/10/2026 (mapping retenu)

Fichier produit depuis le projet « MVP Casier IoT · v2 (axes) » via le connecteur Asana (hors dépôt : `~/.config/lendrr-suivi/import-asana.json`).

- **81 tâches** (dont 9 jalons) et **86 dépendances**. Asana en compte 82 : une tâche sans titre ni notes (HARD, 12–16/11) n'est pas importée. Le brief annonçait 78 dépendances ; les 86 viennent de l'historique des tâches (le connecteur n'expose pas le champ), lu des deux côtés de chaque lien, sans écart.
- **Responsable et heures** : lus dans les notes (`Pilote : Erwen (2 h)`, `Appui : …`). Pour les tâches vidéo, la ligne `Répartition` donne des pourcentages de 4 h (Sophie 75 % = 3 h).
- **Axe** : la section Asana (HARD, SOFT, IA, Pilotage, VIDÉO). Les 9 « Réserves · samedis » vont en PILOTAGE.
- **Réserves** : sans pilote dans Asana, elles reçoivent Tom A. comme `lead` à 0 h (l'import exige exactement un lead).
- **Statut** : `done` si cochée dans Asana, sinon `todo` (Asana n'a pas d'état « en cours »).
- **Dates** : `start_on` / `due_on` ; sans début, la tâche tient sur sa date de fin. Un jalon a une date unique.
- Les adresses e-mail de l'import sont celles de l'app (Tom A. : `tom.archambaud@epita.fr`, pas l'adresse Gmail d'Asana). Les comptes doivent exister avant l'import.
