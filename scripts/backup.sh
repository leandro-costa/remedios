#!/usr/bin/env bash
# Cópia de segurança do banco (formato custom do pg_dump, comprimido).
#
#   scripts/backup.sh                      grava em backups/remedios-AAAAMMDD-HHMMSS.dump
#   scripts/backup.sh caminho/arquivo.dump
#
# Usa o PostgreSQL do docker compose. Para outro servidor, defina PG_EXEC=""
# e as variáveis PGHOST, PGPORT, PGUSER e PGPASSWORD.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_EXEC=${PG_EXEC-docker compose exec -T postgres}
PGUSER=${PGUSER:-${POSTGRES_USER:-remedios}}
DB=${REMEDIOS_DB:-remedios}

file=${1:-backups/remedios-$(date -u +%Y%m%d-%H%M%S).dump}
mkdir -p "$(dirname "$file")"
tmp="$file.partial"
# shellcheck disable=SC2086
$PG_EXEC pg_dump -U "$PGUSER" -d "$DB" --format=custom --compress=9 --no-owner > "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
echo "Cópia gravada em $file ($(du -h "$file" | cut -f1))."
echo "Guarde-a fora deste servidor e cifrada: contém dados de saúde (veja docs/operacao.md)."
