#!/usr/bin/env bash
# Déploiement manuel sur Cassiopée (le jeton ne va jamais dans GitHub ni dans le dépôt).
# Usage :
#   CASSIOPEE_TOKEN_FILE=~/.config/lendrr-suivi/token LENDRR_ENV_FILE=~/.config/lendrr-suivi/env ./deploy/deploy.sh [prod]
# - CASSIOPEE_TOKEN_FILE : fichier hors dépôt contenant le JWT Keycloak (realm SIWEB-Prod).
# - LENDRR_ENV_FILE : fichier shell hors dépôt exportant DATABASE_URL (et SETUP_CODE au 1er déploiement).
# Avant tout POST/PUT : lit GET /quota, affiche ce qui va être créé, attend l'accord explicite.
set -euo pipefail

BASE="${1:-https://cassiopee.siops.sigl.epita.fr/api/v1}"
: "${CASSIOPEE_TOKEN_FILE:?manquant : CASSIOPEE_TOKEN_FILE=<fichier hors dépôt>}"
: "${LENDRR_ENV_FILE:?manquant : LENDRR_ENV_FILE=<fichier hors dépôt>}"
# shellcheck disable=SC1090
source "$LENDRR_ENV_FILE"
: "${DATABASE_URL:?DATABASE_URL manquant dans LENDRR_ENV_FILE}"
: "${IMAGE_TAG:?IMAGE_TAG manquant dans LENDRR_ENV_FILE (ex. sha-abc1234)}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/REMPLACER/lendrr-suivi}"

CFG=$(mktemp)
chmod 600 "$CFG"
trap 'rm -f "$CFG"' EXIT
{
  echo "header = \"Authorization: Bearer $(cat "$CASSIOPEE_TOKEN_FILE")\""
} > "$CFG"

echo "== GET /quota =="
curl -sS --config "$CFG" "$BASE/quota"
echo
read -rp "Créer/mettre à jour base + app + endpoint (voir deploy/*.json) ? [oui/NON] " ok
[[ "$ok" == "oui" ]] || { echo "annulé"; exit 0; }

echo "== POST /databases =="
curl -sS --config "$CFG" -H 'Content-Type: application/json' \
  -X POST "$BASE/databases" --data @deploy/cassiopee-database.json
echo
echo "!! Ranger la chaîne de connexion affichée UNE fois dans $LENDRR_ENV_FILE, ne pas la réafficher."
