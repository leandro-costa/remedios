#!/usr/bin/env bash
# Gera um token no formato do Firebase Authentication assinado com a chave de
# TESTE do repositório, para usar a API localmente sem o Firebase.
# A API precisa estar no modo local (veja .env.example).
#
#   scripts/token-local.sh [uid] [nome]
#   TOKEN=$(scripts/token-local.sh ana "Ana")
#   curl -H "Authorization: Bearer $TOKEN" http://localhost:8010/api/me
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

uid=${1:-usuario-local}
name=${2:-Usuário Local}
project=${FIREBASE_PROJECT_ID:-remedios-local}
key=backend/src/test/resources/privateKey.pem
now=$(date +%s)

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
payload=$(printf '{"iss":"https://securetoken.google.com/%s","aud":"%s","sub":"%s","user_id":"%s","name":"%s","auth_time":%d,"iat":%d,"exp":%d}' \
  "$project" "$project" "$uid" "$uid" "$name" "$now" "$now" "$((now + 3600))" | b64url)
signature=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$key" | b64url)

printf '%s.%s.%s\n' "$header" "$payload" "$signature"
