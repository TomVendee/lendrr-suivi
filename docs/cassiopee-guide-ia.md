# Cassiopée — guide pour un agent IA

Document à donner tel quel à une IA qui doit déployer quelque chose sur Cassiopée.
Source : Swagger de SiOps 0.5.1 (`https://cassiopee.siops.sigl.epita.fr/api/v1/openapi.json`,
lu le 13/10/2026) + mesures du projet. Les points **[mesuré]** viennent de tests
réels, les points **[contrat]** du Swagger. En cas de doute, relire le Swagger :
il fait foi sur les routes et les schémas.

## 1. Ce qu'est Cassiopée

Plateforme libre-service de l'EPITA : chaque utilisateur déploie, via une API REST,
sur le cluster Kubernetes de SiOps, sans jamais parler à Kubernetes :

| Ressource | Ce que c'est |
|---|---|
| **Application** | Une image Docker publique, en `Deployment` (processus permanent) ou `CronJob` (planifié, UTC). Un Service interne la précède. |
| **Endpoint** | Une URL HTTPS publique (Let's Encrypt) vers une application. |
| **Base de données** | PostgreSQL 14-17, MariaDB 10-11 ou MongoDB 6-7, avec volume persistant. |
| **Bucket S3** | Stockage objet S3-compatible (OpenStack Swift). |

Ce qui n'existe pas : registre d'images privé (pas de pull secret), root dans les
conteneurs, ports < 1024, builds (on déploie une image déjà construite et publiée),
versioning et CORS S3.

## 2. Environnements et authentification

| Env | Base URL | Realm Keycloak |
|---|---|---|
| Prod | `https://cassiopee.siops.sigl.epita.fr/api/v1` | `SIWEB-Prod` |
| Staging | `https://cassiopee.staging.siops.sigl.epita.fr/api/v1` | `SIWEB-Dev` |

- Toute route sauf `GET /health` exige `Authorization: Bearer <jeton JWT Keycloak>`,
  client `siweb_oidc`. Un jeton d'un realm est refusé (401) par l'autre environnement.
- **Le jeton vient de l'utilisateur, jamais de toi.** Ne le demande pas dans le chat,
  ne l'écris dans aucun fichier du dépôt, ne le passe pas en argument de commande
  (il finirait dans l'historique) : fichier hors dépôt + `curl --config`, détruit après.
- Identité = claim `preferred_username`. `login` = partie avant `@`, minuscules, tout
  caractère hors `a-z 0-9 . -` remplacé par `-`. Namespace = `cassiopee-app-` + login
  (points → tirets). Chaque utilisateur ne voit que ses ressources.
- 401 `Authentication token expired` → renouveler avec le refresh token.
- Consigne actuelle de l'équipe : **recetter contre la prod de SiOps, pas le staging.**

## 3. Le modèle asynchrone (à comprendre avant tout)

Cassiopée est **GitOps** : une écriture commit la configuration dans Git, ArgoCD
l'applique ensuite (1 à 3 min).

- `202` = « commité », **pas** « en marche ». Le champ `status` d'une écriture dit ce
  qui a été *demandé* (`provisioning`, `updating`, `deleting`…), pas l'état réel.
- Pour l'état réel : **sonder `GET /<type>/{name}/status`** toutes les 5-10 s jusqu'à
  `deployed` (ou `suspended`). Valeurs : `provisioning | deployed | suspended | destroying`.
- `GET /<type>/{name}` rend la config stockée dans Git, éventuellement en avance sur
  le cluster. Après un `DELETE`, `GET` et `/status` répondent 404 tout de suite alors
  que le nettoyage continue.
- `provisioning` > ~10 min : image introuvable/privée, conteneur qui crashe, sonde
  readiness en échec, ou mauvais port.
- Exception : **S3 est synchrone** (`202` + `status: ready` = utilisable de suite).

## 4. Règles de nommage

- `name` (application, endpoint, base, S3) : 1-63 car., `a-z 0-9 -`, ni début ni fin
  par `-` (applications, endpoints). **Immuable** : pour renommer, supprimer et recréer.
- Nom d'**endpoint** : le hôte `<name>.cassiopee.siops.sigl.epita.fr` est **global à la
  plateforme**. Préfixer par le projet ou le login ; sinon `409 ENDPOINT_HOST_CONFLICT`.
- Utilisateur de base : 1-63 car., `a-z 0-9 _`, commence par une lettre ; pas `root`,
  `postgres`, `mariadb`, `mongodb`, `admin`.
- **Tout en minuscules, y compris l'hôte d'un endpoint** [mesuré 06/10] : Kubernetes
  refuse un hôte avec majuscule, l'Ingress n'est jamais créé et l'endpoint reste
  `provisioning` à vie, sans erreur.

## 5. Quotas

Lire **`GET /quota`** : limites, usage et reste. Ne jamais coder les valeurs en dur.

- CPU/mémoire : somme des `resources.limits` × `replicas` des applications + limites
  des bases. Défauts : application 100m/128Mi, base 250m/512Mi.
- Nombre max d'applications, de bases (séparés), d'endpoints **par application**.
  Répliques ≤ 3. Stockage des bases : somme des `storage_size`.
- Buckets S3 : comptés à part, absents de `/quota` et de `/resources`.
- Dépassement → `429 QUOTA_EXCEEDED`, rien n'est créé. Un `PUT` ne compte que la différence.
- Note : l'ancienne observation « 3 ressources au total » date du 15/09 ; le Swagger
  0.5.1 décrit des limites par type. Se fier à `/quota`.

## 6. Recette de déploiement

Ordre recommandé : base → application → endpoint.

### 6.1 Base de données (si besoin)

```http
POST /databases
{"name":"mon-projet-db","engine":"postgresql","version":"16","storage_size":"5Gi","db_name":"app"}
```

- Corps en **snake_case** (`storage_size`, `db_name`) ; un `storageSize` est ignoré
  en silence et retombe sur 10Gi [mesuré].
- **Toujours fixer `version`** : le défaut `17` n'a de sens que pour PostgreSQL
  (MariaDB `11`, MongoDB `7`).
- La réponse contient `connection.password` et `connection_string` **une seule fois**.
  Les remettre immédiatement à l'utilisateur, ne jamais les journaliser ni les commiter.
- Hôte interne : `<name>-<engine>` (ex. `mon-projet-db-postgresql`), joignable seulement
  depuis le namespace de l'utilisateur. Secret Kubernetes `<name>-<engine>-credentials`
  créé ~1 min après.
- Immuables : `engine`, `version`, `storage_size`, `storage_class`, `db_name`. Le `PUT`
  ne change que `resources` selon le Swagger [mesuré : il modifiait le stockage, pas la version].
- Autres routes : `rotate-password`, `users` (POST/GET/DELETE), `suspend` / `resume`
  (données conservées), `DELETE` (délai de grâce de 7 jours côté SiOps).
- **Piège staging** [mesuré] : un compte sans aucune ressource reçoit un 500 « namespaces
  is forbidden » à la première base. Contournement : créer d'abord une application
  (ArgoCD crée le namespace), puis la base passe. À remesurer en prod.
- Un `suspend` est visible comme `destroying` sur `/status` (0 réplique) [mesuré 29/09,
  le Swagger 0.5.1 annonce `suspended`] : ne pas confondre avec une suppression.

### 6.2 Application

```http
POST /applications
{
  "name": "mon-api",
  "image": {"repository": "ghcr.io/org/mon-api", "tag": "1.4.2"},
  "replicas": 1,
  "resources": {"limits": {"cpu": "200m", "memory": "256Mi"}},
  "service": {"port": 80, "target_port": 8080},
  "env": {"DATABASE_URL": "postgresql://postgres:<mdp>@mon-projet-db-postgresql:5432/app"},
  "probes": {"readiness": {"enabled": true, "path": "/ready", "port": 8080}}
}
```

Règles dures :

- **Image publique**, `repository` sans tag + `tag` séparé, pas de digest `@sha256`.
  Éviter `latest` (avec `IfNotPresent`, un `latest` déplacé n'est pas retiré ; sinon
  `pull_policy: "Always"`).
- **Non-root obligatoire** : UID 1000 par défaut, `runAsNonRoot:false` et UID 0 refusés,
  toutes les capabilities retirées. Donc **port > 1024** (8080, 3000) et images de type
  `nginxinc/nginx-unprivileged`, pas `nginx`.
- **`service.target_port` = le port sur lequel le process écoute.** C'est l'erreur n°1.
  Sans lui, l'API prend `ports[http]`, puis l'`EXPOSE` de l'image, puis 3000. Le champ
  `message` de la réponse dit quel port a été retenu et pourquoi : le lire.
  `service.port` (défaut 80) est celui que voient les autres pods et les endpoints.
- **`service` est obligatoire pour y attacher un endpoint.** Un CronJob n'en a pas besoin.
- `POST` est un **upsert qui remplace tout** (les champs omis reviennent aux défauts).
  Pour changer quelques champs : `PUT`.
- `env` : map `NOM: "valeur"`, valeurs en **chaînes** (`"8080"`, pas `8080`). Stocké
  **en clair dans Git** : pas de secret durable. Au `PUT`, `env` est l'ensemble complet
  (ce qu'on omet est supprimé).
- `kind: "CronJob"` : exige `schedule` (cron 5 champs, UTC), le conteneur doit sortir
  seul ; `replicas: 0` met en pause. `restartPolicy` : `OnFailure` ou `Never`.
- `PUT /applications/{name}` : seulement `image`, `replicas`, `resources`, `env`, `ports`,
  `service`, `probes`, `schedule`. Chaque champ envoyé remplace l'ancien en bloc (pas de
  fusion clé par clé, `env` compris). **`kind`, `restartPolicy` et `securityContext` sont
  ignorés en silence** avec un 200 [mesuré].
- Sonder `GET /applications/{name}/status` jusqu'à `deployed` (30 s à 3 min).
- Depuis un autre pod du namespace : `http://<name>:<service.port>`.

Écarts observés sur une vraie app (canary, 06/10/2026) — à garder en tête, possiblement
corrigés depuis :

- Le `POST` **perd le bloc `service`** (l'application revient avec `service: null`) ; le
  même bloc en `PUT` est persisté. Après création, vérifier `GET`, puis `PUT` si besoin.
- Les **sondes** et les **requests/limits** n'étaient pas appliquées au pod (le chart les
  avait en commentaire) : le quota CPU/RAM était théorique.
- `/tmp` est toujours inscriptible (emptyDir) ; le groupe reste gid 0.

### 6.3 Endpoint (exposition publique)

```http
POST /endpoints
{"name":"mon-projet-api","applicationName":"mon-api","path":"/","pathType":"Prefix"}
```

- Résultat : `https://mon-projet-api.cassiopee.siops.sigl.epita.fr`, TLS Let's Encrypt,
  HTTP redirigé vers HTTPS, WebSocket activé (timeouts 3600 s).
- `host` personnalisé : **un seul label** sous `cassiopee.siops.sigl.epita.fr` ou
  `cassiopee.sigl.epita.fr`, en minuscules ; sinon laisser vide. Unique sur la plateforme.
- `applicationName` : une de ses applications **avec un service**. `applicationPort` :
  laisser vide (il doit égaler `service.port`).
- `path` est transmis tel quel : **pas de suppression de préfixe**. Une app montée sur `/`
  derrière `path: /api` reçoit `/api/...`.
- `tls.issuer` : laisser vide (seul `letsencrypt` est accepté).
- `annotations` : liste blanche ingress-nginx (taille de corps, timeouts, buffering, CORS,
  rate limit, rewrite-target, app-root, redirections SSL, sticky sessions) ; pas de
  `; { } \ " ' #` ni de retour à la ligne.
- `deployed` seulement quand l'ingress publie une adresse ; sinon `provisioning` avec
  `details.message` : « Namespace not yet created », « Ingress not yet created » ou
  « Waiting for load balancer ». Le certificat peut mettre ~1 min.
- Écarts observés (06/10, prod) : certificat factice d'ingress-nginx servi même après
  `deployed` (cause non établie) ; un `PUT` sans changement répond succès sans rien faire ;
  les annotations personnalisées ne passaient pas via le relais de l'intranet (envoyées
  en tableau, attendues en map).

### 6.4 Bucket S3

```http
POST /s3            {"name":"mon-projet-assets","bucket_name":"mon-projet-assets","policy":"private"}
GET  /s3/{name}/credentials   -> {"access_key":"...","secret_key":"..."}
```

- `bucket_name` est **global au projet OpenStack** : distinctif, sinon `409`.
- `policy` : `private` (défaut) ou `public` (lecture anonyme). `versioning_enabled` et
  `cors_enabled` doivent rester `false`.
- Client S3 : utiliser `endpoint_url` de la réponse, adressage **path-style**
  (`Config(s3={"addressing_style":"path"})` en boto3), nom de bucket = `bucket_name`.
- Les clés sont un secret : ne pas les afficher ni les écrire dans le dépôt.
- **Au 09/10/2026, S3 répondait 503** en staging et en prod (`OPENSTACK_PASSWORD` absent
  de la config SiOps). Tester `GET /s3` avant de promettre quoi que ce soit.

## 7. Erreurs

Corps uniforme `{"error_code","message","details"}`. Brancher sur `error_code` (stable),
montrer `message`. 400 requête invalide ; 401 jeton ; 404 inconnu ; 409 conflit
(nom/hôte pris, bucket non vide) ; 422 schéma (`details.errors[].loc/msg`) ; 429 quota ;
500 panne plateforme (réessayer une fois) ; 503 dépendance indisponible. Un statut hors
de cette liste (502/504 d'ingress, HTML) vient d'un proxy et n'a aucune forme garantie :
tronquer avant d'afficher.

## 8. Règles de conduite pour l'agent

1. **Créer coûte.** Environnement partagé, quota par utilisateur : lire `GET /quota`, dire
   à l'utilisateur ce que tu vas créer, **attendre son accord** avant tout `POST`, `PUT`,
   `DELETE`, `suspend`.
2. `DELETE` d'une base = perte de données. Ne jamais supprimer ce que tu n'as pas créé
   dans la session, ni sans confirmation explicite.
3. Après chaque écriture : sonder `/status`, ne pas déclarer « déployé » sur un `202`.
4. Pour tout échec : relire `message` de la réponse, `details.message` du `/status`, puis
   l'image (publique ? tag existant ? port ?). Ne pas boucler sur des `POST`.
5. Un secret (jeton, mot de passe de base, clé S3) ne va jamais dans un fichier du dépôt,
   un commit, un journal ou une URL.
6. Ne pas affirmer qu'une route existe ou manque sans avoir lu `openapi.json`.
7. Prod et staging sont deux mondes : jetons, URL et ressources distincts.

## 9. Checklist rapide

- [ ] Image publique, tag précis, écoute sur un port > 1024, non-root
- [ ] `service.target_port` = port d'écoute réel ; `service` présent si endpoint
- [ ] `env` en chaînes, sans secret durable ; chaîne de connexion de la base copiée au 1er affichage
- [ ] `GET /quota` lu, accord de l'utilisateur obtenu
- [ ] Noms et hôtes en minuscules, nom d'endpoint distinctif
- [ ] `/status` sondé jusqu'à `deployed`, puis URL testée (`curl -I https://…`)
