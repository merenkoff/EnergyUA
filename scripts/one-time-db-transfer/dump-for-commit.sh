#!/usr/bin/env bash
# Локально: зняти дамп у committed-dump/electroheat.dump — файл призначений для ОДНОГО коміту в git, потім видалити.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST_DIR="$ROOT/scripts/one-time-db-transfer/committed-dump"
DUMP_FILE="$DEST_DIR/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-transfer-log.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"

cd "$ROOT"
transfer_log_init "dump-for-commit.sh"
trap 'ec=$?; [[ $ec -ne 0 ]] && transfer_log_fail "$ec"; exit "$ec"' ERR

transfer_log "УВАГА: дамп може містити персональні дані / внутрішню інформацію — не публікуй репо публічно без оцінки ризику."

if ! command -v pg_dump >/dev/null 2>&1; then
  transfer_log "FAIL: потрібен pg_dump (brew install libpq)"
  exit 1
fi

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
fi
if [[ -z "${SOURCE_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  SOURCE_DATABASE_URL="$DATABASE_URL"
fi
if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  transfer_log "FAIL: DATABASE_URL у .env або SOURCE_DATABASE_URL"
  exit 1
fi

transfer_log "Джерело (масковано): $(transfer_mask_url "$SOURCE_DATABASE_URL")"
SOURCE_PG_URL="$(pg_url_for_libpq "$SOURCE_DATABASE_URL")"
transfer_log "Для pg_dump прибрано Prisma-параметр schema= з URI (libpq його не підтримує)"

mkdir -p "$DEST_DIR"
rm -f "$DUMP_FILE"

transfer_log "pg_dump → $DUMP_FILE (custom, для коміту)"
set +e
pg_dump "$SOURCE_PG_URL" --format=custom --no-owner --file="$DUMP_FILE" 2>&1 | tee -a "$TRANSFER_LOG_FILE"
EC=${PIPESTATUS[0]}
set -e
if [[ "$EC" -ne 0 ]]; then
  transfer_log "FAIL: pg_dump $EC"
  transfer_log_fail "$EC"
  exit "$EC"
fi

SZ=$(wc -c <"$DUMP_FILE" | tr -d ' ')
transfer_log "OK: $(ls -lh "$DUMP_FILE") байт=$SZ"
if [[ "$SZ" -gt 90000000 ]]; then
  transfer_log "Попередження: >~90 MiB — на GitHub ліміт 100 MiB; розглянь Git LFS або стиснення окремим кроком."
fi

echo ""
echo "Далі:"
echo "  1) git add scripts/one-time-db-transfer/committed-dump/electroheat.dump"
echo "  2) Закоміть разом зі змінами db:predeploy (якщо ще не в main)."
echo "  3) У Railway Variables: IMPORT_COMMITTED_DUMP=yes"
echo "  4) Опційно для pg_restore: RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client"
echo "  5) Після успішного деплою: прибери IMPORT_COMMITTED_DUMP, видали дамп і скрипти (етап прибирання)."
echo "Лог: $TRANSFER_LOG_FILE"
