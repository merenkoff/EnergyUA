#!/usr/bin/env bash
# Pre-deploy (Railway): одноразовий імпорт з committed-dump/electroheat.dump, якщо IMPORT_COMMITTED_DUMP=yes.
# Після успіху змінну прибери з Railway і видали дамп з репозиторію.
set -euo pipefail

if [[ "${IMPORT_COMMITTED_DUMP:-}" != "yes" ]]; then
  echo "[import-committed-dump] пропуск (одноразово задай IMPORT_COMMITTED_DUMP=yes у Variables)"
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DUMP_FILE="$ROOT/scripts/one-time-db-transfer/committed-dump/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "[import-committed-dump] ПОМИЛКА: немає файлу $DUMP_FILE — закоміть electroheat.dump (npm run db:ot:dump-for-commit)." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[import-committed-dump] ПОМИЛКА: немає DATABASE_URL" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "[import-committed-dump] ПОМИЛКА: немає pg_restore у образі." >&2
  echo "У Railway → Variables додай (тимчасово або постійно):" >&2
  echo "  RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client" >&2
  exit 1
fi

DATABASE_PG_URL="$(pg_url_for_libpq "$DATABASE_URL")"
echo "[import-committed-dump] Одноразовий pg_restore з репозиторію → DATABASE_URL (масковано: $(echo "$DATABASE_URL" | sed -E 's#(postgres(ql)?://[^:/@]+:)[^@]*@#\1***@#'), без Prisma schema= у URI для libpq)"
set +e
pg_restore \
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

echo "[import-committed-dump] Готово. Прибери з Railway IMPORT_COMMITTED_DUMP, видали committed-dump/electroheat.dump і цей скрипт з репо; поверни db:predeploy без імпорту."
