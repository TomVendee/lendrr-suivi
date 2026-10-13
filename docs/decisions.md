# Décisions techniques

État au 13/10/2026. Une décision « tranchée » ne se rediscute qu'avec Tom A. ; une décision « ouverte » a une
valeur par défaut à appliquer tant que rien d'autre n'est décidé.

## Tranchées

| # | Sujet | Décision | Pourquoi |
| --- | --- | --- | --- |
| D1 | Hébergement | **Cassiopée (prod SiOps)**, voir `cassiopee-guide-ia.md` | Contrainte du projet. Gratuit, HTTPS fourni, Postgres managé. |
| D2 | Forme du déploiement | **Une seule image Docker** : le serveur Node sert l'API (`/api/*`) et les fichiers du front. Une Application `Deployment`, un Endpoint, une base. | Moins de ressources consommées sur le quota, un seul endpoint, pas de CORS. |
| D3 | Langage | **TypeScript** partout (front, serveur, logique métier). | Un seul langage pour un développeur seul ; types partagés entre front et serveur. |
| D4 | Serveur | **Node 22 + Hono**, validation des entrées avec **Zod**. | Léger en mémoire (limite visée 256Mi), simple. |
| D5 | Front | **React + Vite** (SPA), **TanStack Query** pour les données, CSS simple avec les jetons de couleur des maquettes. | Écosystème le mieux connu de Claude Code ; le Gantt et les graphes se dessinent en SVG/React. |
| D6 | Base | **PostgreSQL 16** sur Cassiopée (`storage_size` 1Gi, à ajuster selon `/quota`), ORM **Drizzle** + migrations versionnées, appliquées au démarrage du serveur. | Base managée et persistante ; les migrations au démarrage évitent tout accès manuel au cluster. |
| D7 | Logique métier | Fonctions **pures** dans `src/domain/` (jours ouvrés, charge, décalage, chemin critique, alertes, validation), testées avec **Vitest**. | Ce sont les règles qui comptent pour la soutenance ; elles doivent être justes et prouvées. |
| D8 | Connexion | **E-mail + mot de passe** (argon2id), sessions en cookie `HttpOnly; Secure; SameSite=Lax` stockées en base. Comptes créés par le chef de projet. | Pas de SMTP pour un lien magique, pas de client OAuth Google à enregistrer. 6 utilisateurs. |
| D9 | Premier compte | Page `/setup` active **seulement tant qu'aucun utilisateur n'existe**, protégée par un code `SETUP_CODE` passé en variable d'environnement, retirée après usage. | Cassiopée ne donne aucun accès shell au pod : impossible de lancer une commande de création d'admin. |
| D10 | Images | Construites par **GitHub Actions**, publiées sur **ghcr.io en paquet public**, tag = version ou SHA court, **jamais `latest`**. | Cassiopée n'accepte que des images publiques déjà construites. |
| D11 | Conteneur | Base `node:22-alpine`, utilisateur `node` (UID 1000), écoute sur **8080**, sondes `/health` (vivant) et `/ready` (base joignable). | Règles non-root et port > 1024 de Cassiopée. |
| D12 | Noms Cassiopée | Base `lendrr-suivi-db` (hôte interne `lendrr-suivi-db-postgresql`), application `lendrr-suivi`, endpoint `lendrr-suivi` → `https://lendrr-suivi.cassiopee.siops.sigl.epita.fr`. | Préfixe projet pour éviter les conflits d'hôte globaux ; tout en minuscules. |
| D13 | Mode de décalage | **Seulement en cas de chevauchement**, en jours ouvrés. Les jalons ne bougent jamais seuls. | Déjà fixé dans le cahier. |
| D14 | Mise à jour | **Pas de temps réel en V1** : rechargement des données au retour sur l'onglet et toutes les 60 s (TanStack Query). | Simplicité ; 6 utilisateurs. |
| D15 | Synthèse hebdo | **Texte à trous** rempli par l'app, que le chef de projet relit. Pas de clé d'API d'IA en V1. | Gratuit, pas de secret à stocker. |
| D16 | Langue et temps | Interface en **français**, fuseau **Europe/Paris**, semaines du lundi au vendredi, numérotées depuis le début du projet (S06 = semaine du 28/09/2026, donc S01 = 24/08/2026), réglable. | Usage de l'équipe. |
| D17 | Direction artistique | **Neutre et réutilisable** : nom « Suivi projet », le projet (LENDRR) n'est qu'une donnée. Jetons dans `docs/maquettes/README.md`. | Demande du chef de projet. |

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
