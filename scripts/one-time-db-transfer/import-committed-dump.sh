#!/usr/bin/env bash
# Pre-deploy (Railway): одноразовий імпорт з committed-dump/, якщо IMPORT_COMMITTED_DUMP=yes.
# Пріоритет: electroheat.sql (psql) — сумісно з pg_restore 15 у Debian; інакше electroheat.dump (pg_restore, потрібна та ж major що й дамп).
# Після успіху змінну прибери з Railway і видали файли з репозиторію.
set -euo pipefail

if [[ "${IMPORT_COMMITTED_DUMP:-}" != "yes" ]]; then
  echo "[import-committed-dump] пропуск (одноразово задай IMPORT_COMMITTED_DUMP=yes у Variables)"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="$ROOT/scripts/one-time-db-transfer/committed-dump"
SQL_FILE="$DIR/electroheat.sql"
DUMP_FILE="$DIR/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-bin.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[import-committed-dump] ПОМИЛКА: немає DATABASE_URL" >&2
  exit 1
fi

DATABASE_PG_URL="$(pg_url_for_libpq "$DATABASE_URL")"
MASKED="$(echo "$DATABASE_URL" | sed -E 's#(postgres(ql)?://[^:/@]+:)[^@]*@#\1***@#')"

if [[ -f "$SQL_FILE" ]]; then
  PSQL_EXE="$(resolve_psql)" || true
  if [[ -z "$PSQL_EXE" || ! -x "$PSQL_EXE" ]]; then
    echo "[import-committed-dump] ПОМИЛКА: немає psql. Додай postgresql-client (railpack.json / RAILPACK_DEPLOY_APT_PACKAGES)." >&2
    exit 1
  fi
  echo "[import-committed-dump] psql: $PSQL_EXE ($("$PSQL_EXE" --version 2>&1))"
  echo "[import-committed-dump] Одноразовий імпорт plain SQL → DATABASE_URL (масковано: $MASKED)"
  set +e
  "$PSQL_EXE" "$DATABASE_PG_URL" -v ON_ERROR_STOP=1 --echo-errors -f "$SQL_FILE" 2>&1
  REST_EC=$?
  set -e
  if [[ "$REST_EC" -ne 0 ]]; then
    echo "[import-committed-dump] psql завершився з кодом $REST_EC" >&2
    exit "$REST_EC"
  fi
elif [[ -f "$DUMP_FILE" ]]; then
  PG_RESTORE_EXE="$(resolve_pg_restore)" || true
  if [[ -z "$PG_RESTORE_EXE" || ! -x "$PG_RESTORE_EXE" ]]; then
    echo "[import-committed-dump] ПОМИЛКА: немає pg_restore. Додай postgresql-client." >&2
    exit 1
  fi
  echo "[import-committed-dump] pg_restore: $PG_RESTORE_EXE ($("$PG_RESTORE_EXE" --version 2>&1))"
  echo "[import-committed-dump] УВАГА: custom .dump має бути зібраний pg_dump тієї ж major, що pg_restore (інакше unsupported version у заголовку)."
  echo "[import-committed-dump] Одноразовий pg_restore → DATABASE_URL (масковано: $MASKED)"
  set +e
  "$PG_RESTORE_EXE" \
    --dbname="$DATABASE_PG_URL" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --verbose \
    "$DUMP_FILE" \
    2>&1
  REST_EC=$?
  set -e
  if [[ "$REST_EC" -ne 0 ]]; then
    echo "[import-committed-dump] pg_restore завершився з кодом $REST_EC" >&2
    exit "$REST_EC"
  fi
else
  echo "[import-committed-dump] ПОМИЛКА: немає $SQL_FILE ні $DUMP_FILE — npm run db:ot:dump-for-commit (створює electroheat.sql)." >&2
  exit 1
fi

echo "[import-committed-dump] Готово. Прибери IMPORT_COMMITTED_DUMP, видали committed-dump/*.sql / *.dump і цей скрипт з репо; поверни db:predeploy без імпорту."
