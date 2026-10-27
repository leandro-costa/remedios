#!/usr/bin/env bash
# Restaura uma cópia de segurança SOBRE o banco atual (destrutivo).
#
#   scripts/restore.sh backups/remedios-AAAAMMDD-HHMMSS.dump --confirmar
#
# Pare a API antes (docker compose stop api) e suba de novo depois. Para
# conferir uma cópia sem tocar no banco, use scripts/restore-test.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

file=${1:?Informe o arquivo da cópia.}
[[ "${2:-}" == "--confirmar" ]] || { echo "Isso apaga o banco atual. Repita com --confirmar." >&2; exit 2; }
[[ -s "$file" ]] || { echo "Arquivo vazio ou inexistente: $file" >&2; exit 1; }

PG_EXEC=${PG_EXEC-docker compose exec -T postgres}
PGUSER=${PGUSER:-${POSTGRES_USER:-remedios}}
DB=${REMEDIOS_DB:-remedios}

# shellcheck disable=SC2086
$PG_EXEC psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\" OWNER \"$PGUSER\""
# shellcheck disable=SC2086
$PG_EXEC pg_restore -U "$PGUSER" -d "$DB" --no-owner --exit-on-error < "$file"
echo "Banco $DB restaurado de $file. Suba a API: docker compose start api"
