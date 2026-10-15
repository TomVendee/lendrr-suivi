#!/usr/bin/env bash
# Déploiement manuel sur Cassiopée (voir docs/cassiopee-guide-ia.md). Le jeton ne va jamais dans
# GitHub, le dépôt, un argument de commande ni la sortie : il passe par un fichier curl temporaire (600).
#
# Usage :
#   CASSIOPEE_TOKEN_FILE=~/.config/lendrr-suivi/token LENDRR_ENV_FILE=~/.config/lendrr-suivi/env \
#     ./deploy/deploy.sh <commande>
#
# Lecture seule : quota | status
# Écritures (confirmation « oui » demandée, ou CONFIRM=oui) :
#   db          crée la base iplanner-db ; range DATABASE_URL dans LENDRR_ENV_FILE sans l'afficher
#   app         crée l'application iplanner (image IMAGE_REPO:IMAGE_TAG, env depuis LENDRR_ENV_FILE)
#   endpoint    crée l'URL publique https://iplanner.cassiopee.siops.sigl.epita.fr
#   env         remplace l'env de l'application (retirer SETUP_CODE du fichier puis relancer)
#   image TAG   déploie une autre version (tag ghcr.io, jamais latest)
#
# LENDRR_ENV_FILE (hors dépôt) : IMAGE_REPO, IMAGE_TAG, DATABASE_URL, et SETUP_CODE au premier lancement.
set -euo pipefail

BASE="${CASSIOPEE_BASE:-https://cassiopee.siops.sigl.epita.fr/api/v1}"
APP_URL="https://iplanner.cassiopee.siops.sigl.epita.fr"
DIR="$(cd "$(dirname "$0")" && pwd)"
: "${CASSIOPEE_TOKEN_FILE:?manquant : CASSIOPEE_TOKEN_FILE=<fichier hors dépôt>}"
: "${LENDRR_ENV_FILE:?manquant : LENDRR_ENV_FILE=<fichier hors dépôt>}"

CFG=$(mktemp)
OUT=$(mktemp)
chmod 600 "$CFG" "$OUT"
trap 'rm -f "$CFG" "$OUT"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\n' < "$CASSIOPEE_TOKEN_FILE")" > "$CFG"

# Variables du fichier env, lues sans les afficher.
envval() { python3 - "$LENDRR_ENV_FILE" "$1" <<'EOF'
import re, sys
for line in open(sys.argv[1]):
    m = re.match(r'\s*(?:export\s+)?([A-Z_]+)=(.*)$', line.rstrip('\n'))
    if m and m.group(1) == sys.argv[2]:
        v = m.group(2).strip()
        print(v[1:-1] if len(v) > 1 and v[0] == v[-1] and v[0] in "'\"" else v)
EOF
}

# Appel API : code HTTP en sortie, corps dans $OUT (jamais affiché en entier pour la base).
call() { curl -sS --config "$CFG" -o "$OUT" -w "%{http_code}" -H 'Content-Type: application/json' "$@"; }

confirm() {
  echo "$1"
  if [[ "${CONFIRM:-}" == "oui" ]]; then return 0; fi
  read -rp "Confirmer ? [oui/NON] " ok
  [[ "$ok" == "oui" ]] || { echo "Annulé."; exit 0; }
}

# Sonde /status jusqu'à deployed (10 min max). Un 202 n'est pas un déploiement réussi.
wait_deployed() {
  local kind=$1 name=$2 st
  for _ in $(seq 60); do
    call "$BASE/$kind/$name/status" >/dev/null || true
    st=$(python3 -c "import json; d=json.load(open('$OUT')); print(d.get('status','?'), (d.get('details') or {}).get('message',''))" 2>/dev/null || echo "?")
    echo "  $kind/$name : $st"
    [[ "$st" == deployed* ]] && return 0
    sleep 10
  done
  echo "!! $kind/$name pas deployed après 10 min : lire details.message, vérifier image, port et sonde." >&2
  return 1
}

app_env_json() { python3 - "$APP_URL" "$(envval DATABASE_URL)" "$(envval SETUP_CODE)" <<'EOF'
import json, sys
env = {"DATABASE_URL": sys.argv[2], "PORT": "8080", "APP_URL": sys.argv[1]}
if sys.argv[3]:
    env["SETUP_CODE"] = sys.argv[3]
print(json.dumps(env))
EOF
}

cmd="${1:-}"
case "$cmd" in
  quota)
    call "$BASE/quota"; echo; cat "$OUT"; echo ;;

  status)
    for r in databases/iplanner-db applications/iplanner endpoints/iplanner; do
      code=$(call "$BASE/$r/status") || true
      echo "$r : HTTP $code $(head -c 300 "$OUT")"
    done ;;

  db)
    confirm "Créer la base PostgreSQL 16 « iplanner-db » (1Gi, db_name app) ?"
    code=$(call -X POST "$BASE/databases" --data @"$DIR/cassiopee-database.json")
    if [[ "$code" != 2* ]]; then echo "Échec HTTP $code : $(head -c 400 "$OUT")" >&2; exit 1; fi
    # La chaîne de connexion n'est montrée qu'une fois : rangée directement dans le fichier hors dépôt.
    python3 - "$OUT" "$LENDRR_ENV_FILE" <<'EOF'
import json, re, sys
d = json.load(open(sys.argv[1]))
url = d.get("connection_string") or (d.get("connection") or {}).get("connection_string")
if not url:
    sys.exit("Pas de connection_string dans la réponse : la récupérer dans l'interface Cassiopée.")
path = sys.argv[2]
lines = [l for l in open(path) if not re.match(r'\s*(export\s+)?DATABASE_URL=', l)]
lines.append(f"export DATABASE_URL='{url}'\n")
open(path, "w").writelines(lines)
print("DATABASE_URL rangée dans le fichier env (non affichée).")
EOF
    wait_deployed databases iplanner-db ;;

  app)
    repo=$(envval IMAGE_REPO); tag=$(envval IMAGE_TAG)
    [[ -n "$repo" && -n "$tag" && "$tag" != latest ]] || { echo "IMAGE_REPO / IMAGE_TAG (pas latest) requis" >&2; exit 1; }
    [[ -n "$(envval DATABASE_URL)" ]] || { echo "DATABASE_URL absente : lancer « db » d'abord" >&2; exit 1; }
    confirm "Créer l'application « iplanner » : image $repo:$tag, 200m / 256Mi, port 8080, sonde /ready, SETUP_CODE $( [[ -n "$(envval SETUP_CODE)" ]] && echo présent || echo absent ) ?"
    body=$(python3 - "$DIR/cassiopee-application.json" "$repo" "$tag" "$(app_env_json)" <<'EOF'
import json, sys
a = json.load(open(sys.argv[1]))
a["image"] = {"repository": sys.argv[2], "tag": sys.argv[3]}
a["env"] = json.loads(sys.argv[4])
print(json.dumps(a))
EOF
)
    code=$(call -X POST "$BASE/applications" --data "$body")
    if [[ "$code" != 2* ]]; then echo "Échec HTTP $code : $(head -c 400 "$OUT")" >&2; exit 1; fi
    python3 -c "import json; print('Message Cassiopée :', json.load(open('$OUT')).get('message',''))"
    # Écart connu : le POST peut perdre le bloc service ; on relit et on le renvoie en PUT si besoin.
    call "$BASE/applications/iplanner" >/dev/null
    if python3 -c "import json,sys; sys.exit(0 if json.load(open('$OUT')).get('service') else 1)"; then
      echo "Bloc service présent."
    else
      echo "Bloc service perdu par le POST : renvoi en PUT."
      code=$(call -X PUT "$BASE/applications/iplanner" --data '{"service":{"port":80,"target_port":8080}}')
      [[ "$code" == 2* ]] || { echo "PUT service HTTP $code : $(head -c 300 "$OUT")" >&2; exit 1; }
    fi
    wait_deployed applications iplanner ;;

  endpoint)
    confirm "Créer l'endpoint « iplanner » → $APP_URL ?"
    code=$(call -X POST "$BASE/endpoints" --data @"$DIR/cassiopee-endpoint.json")
    if [[ "$code" != 2* ]]; then echo "Échec HTTP $code : $(head -c 400 "$OUT")" >&2; exit 1; fi
    wait_deployed endpoints iplanner
    echo "Test : $(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/ready") sur $APP_URL/ready" ;;

  env)
    confirm "Remplacer l'env de « iplanner » (DATABASE_URL, PORT, APP_URL$( [[ -n "$(envval SETUP_CODE)" ]] && echo ', SETUP_CODE' )) ?"
    code=$(call -X PUT "$BASE/applications/iplanner" --data "{\"env\": $(app_env_json)}")
    [[ "$code" == 2* ]] || { echo "Échec HTTP $code : $(head -c 300 "$OUT")" >&2; exit 1; }
    wait_deployed applications iplanner ;;

  image)
    tag="${2:?tag requis (ex. sha-abc1234)}"; repo=$(envval IMAGE_REPO)
    [[ "$tag" != latest ]] || { echo "Jamais latest (D10)." >&2; exit 1; }
    confirm "Déployer $repo:$tag sur « iplanner » ?"
    code=$(call -X PUT "$BASE/applications/iplanner" --data "{\"image\":{\"repository\":\"$repo\",\"tag\":\"$tag\"}}")
    [[ "$code" == 2* ]] || { echo "Échec HTTP $code : $(head -c 300 "$OUT")" >&2; exit 1; }
    wait_deployed applications iplanner ;;

  *)
    sed -n '2,17p' "$0"; exit 1 ;;
esac
