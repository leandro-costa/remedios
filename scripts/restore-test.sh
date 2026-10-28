#!/usr/bin/env bash
# Teste de restauração (seção 12): copia o banco, restaura a cópia num banco
# separado e confere que tudo voltou igual (cada tabela, linha a linha, e o
# histórico das migrações). Não toca no banco em uso.
#
#   scripts/restore-test.sh            usa uma cópia nova do banco atual
#   scripts/restore-test.sh arquivo    confere uma cópia já existente
#
# Com --exigir-dados, falha se as tabelas principais estiverem vazias (CI).
set -euo pipefail
cd "$(dirname "$0")/.."

PG_EXEC=${PG_EXEC-docker compose exec -T postgres}
PGUSER=${PGUSER:-${POSTGRES_USER:-remedios}}
DB=${REMEDIOS_DB:-remedios}
SCRATCH=${DB}_restore_test

require_data=false
file=""
for arg in "$@"; do
  case "$arg" in
    --exigir-dados) require_data=true ;;
    *) file=$arg ;;
  esac
done

psql_in() {
  # shellcheck disable=SC2086
  $PG_EXEC psql -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 -qtA -c "SET client_min_messages = warning" -c "$2"
}

work=$(mktemp -d)
trap 'rm -rf "$work"; psql_in postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || true' EXIT

# Impressão digital de cada tabela: quantidade de linhas e hash do conteúdo
# em ordem estável. Igual nos dois bancos = restauração fiel.
fingerprint='
SELECT string_agg(t.table_name || " " || f.rows || " " || f.hash, E"\n" ORDER BY t.table_name)
FROM information_schema.tables t,
LATERAL (
  SELECT (xpath($$/row/n/text()$$, x))[1]::text AS rows, (xpath($$/row/h/text()$$, x))[1]::text AS hash
  FROM query_to_xml(format(
    $$SELECT count(*) AS n, coalesce(md5(string_agg(md5(r::text), $s$,$s$ ORDER BY md5(r::text))), $s$-$s$) AS h FROM %I.%I r$$,
    t.table_schema, t.table_name), false, true, $$$$) AS x
) f
WHERE t.table_schema = $$public$$ AND t.table_type = $$BASE TABLE$$'
fingerprint=${fingerprint//\"/\'}

if [[ -z "$file" ]]; then
  # Com a API no ar, o banco pode mudar durante a cópia (ex.: o publicador de
  # avisos marcando eventos como enviados). Vale a cópia feita sem mudança
  # entre antes e depois; senão, tenta de novo.
  file="$work/copia.dump"
  for attempt in 1 2 3 4 5; do
    psql_in "$DB" "$fingerprint" > "$work/antes.txt"
    PG_EXEC="$PG_EXEC" scripts/backup.sh "$file" >/dev/null
    psql_in "$DB" "$fingerprint" > "$work/atual.txt"
    cmp -s "$work/antes.txt" "$work/atual.txt" && break
    if [[ $attempt == 5 ]]; then
      echo "FALHA: o banco mudou durante todas as tentativas de cópia." >&2
      exit 1
    fi
    sleep 2
  done
else
  psql_in "$DB" "$fingerprint" > "$work/atual.txt"
fi

psql_in postgres "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)"
psql_in postgres "CREATE DATABASE \"$SCRATCH\" OWNER \"$PGUSER\""
# shellcheck disable=SC2086
$PG_EXEC pg_restore -U "$PGUSER" -d "$SCRATCH" --no-owner --exit-on-error < "$file"

psql_in "$SCRATCH" "$fingerprint" > "$work/restaurado.txt"

if ! diff -u "$work/atual.txt" "$work/restaurado.txt"; then
  echo "FALHA: a cópia restaurada difere do banco atual." >&2
  exit 1
fi

if $require_data; then
  for table in family person treatment dose_occurrence administration_record measurement; do
    rows=$(awk -v t="$table" '$1 == t {print $2}' "$work/atual.txt")
    if [[ -z "$rows" || "$rows" == "0" ]]; then
      echo "FALHA: tabela $table vazia; o teste não exercitou dados reais." >&2
      exit 1
    fi
  done
fi

tables=$(wc -l < "$work/atual.txt")
rows=$(awk '{s += $2} END {print s}' "$work/atual.txt")
echo "Restauração conferida: $tables tabelas, $rows linhas, conteúdo idêntico (inclui o histórico das migrações)."
