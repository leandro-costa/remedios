#!/usr/bin/env bash
# Gera um par de chaves VAPID (P-256) para o Web Push, no formato usado pelos
# navegadores (base64url): pública com 65 bytes, privada com 32 bytes.
#
#   scripts/vapid-keys.sh >> .env
#
# Guarde a privada como segredo. Trocar as chaves invalida as inscrições
# existentes: cada aparelho precisa ativar as notificações de novo.
set -euo pipefail

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$tmp" 2>/dev/null
text=$(openssl ec -in "$tmp" -noout -text 2>/dev/null)

hex_of() { echo "$text" | awk -v section="$1" '
  $0 ~ "^"section":" { on = 1; next }
  on && /^[A-Za-z]/ { on = 0 }
  on { gsub(/[ :]/, ""); printf "%s", $0 }'; }

b64url() { printf '%b' "$(sed 's/../\\x&/g')" | openssl base64 -A | tr '+/' '-_' | tr -d '='; }

priv=$(hex_of priv)
# A chave privada pode vir com um byte 00 à esquerda; ficam só os 32 bytes finais.
priv=${priv: -64}
pub=$(hex_of pub)

echo "REMEDIOS_VAPID_PUBLIC_KEY=$(echo "$pub" | b64url)"
echo "REMEDIOS_VAPID_PRIVATE_KEY=$(echo "$priv" | b64url)"
echo "REMEDIOS_VAPID_SUBJECT=mailto:troque@exemplo.com.br"
