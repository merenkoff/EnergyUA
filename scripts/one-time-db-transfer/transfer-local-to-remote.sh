#!/usr/bin/env bash
# Одна команда: дамп з локального DATABASE_URL (.env) → pg_restore на TARGET_DATABASE_URL (Railway).
# Запуск тільки на твоїй машині, де доступна локальна Postgres і встановлені pg_dump/pg_restore.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT/scripts/one-time-db-transfer/out"
DUMP_FILE="$OUT_DIR/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-transfer-log.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"

cd "$ROOT"
transfer_log_init "transfer-local-to-remote.sh (dump + restore)"
trap 'ec=$?; [[ $ec -ne 0 ]] && transfer_log_fail "$ec"; exit "$ec"' ERR

transfer_log "Режим: автоматичний перенос локальна БД → віддалена (один запуск)"

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  transfer_log "FAIL: потрібні pg_dump і pg_restore (brew install libpq)"
  echo "Потрібні pg_dump і pg_restore. macOS: brew install libpq && brew link --force libpq" >&2
  exit 1
fi
transfer_log "pg_dump: $(pg_dump --version 2>&1)"
transfer_log "pg_restore: $(pg_restore --version 2>&1)"

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    transfer_log "Крок: читаю .env для DATABASE_URL (джерело)"
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
  transfer_log "FAIL: немає джерела — DATABASE_URL у .env або SOURCE_DATABASE_URL"
  echo "Поклади DATABASE_URL у .env або задай SOURCE_DATABASE_URL=..." >&2
  exit 1
fi

if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  transfer_log "FAIL: не задано TARGET_DATABASE_URL"
  echo "Задай URL продакшен-Postgres, наприклад:" >&2
  echo "  REALLY_REPLACE_REMOTE=yes TARGET_DATABASE_URL='postgresql://...?sslmode=require' npm run db:ot:transfer" >&2
  exit 1
fi
if [[ "${REALLY_REPLACE_REMOTE:-}" != "yes" ]]; then
  transfer_log "Скасовано: потрібно REALLY_REPLACE_REMOTE=yes"
  echo "Перезапис віддаленої БД. Запуск:" >&2
  echo "  REALLY_REPLACE_REMOTE=yes TARGET_DATABASE_URL='...' npm run db:ot:transfer" >&2
  exit 1
fi

transfer_log "Джерело (масковано): $(transfer_mask_url "$SOURCE_DATABASE_URL")"
transfer_log "Ціль (масковано): $(transfer_mask_url "$TARGET_DATABASE_URL")"
SOURCE_PG_URL="$(pg_url_for_libpq "$SOURCE_DATABASE_URL")"
TARGET_PG_URL="$(pg_url_for_libpq "$TARGET_DATABASE_URL")"

mkdir -p "$OUT_DIR"
rm -f "$DUMP_FILE"

transfer_log "Крок 1/2: pg_dump → electroheat.dump (URI без Prisma schema=)"
set +e
pg_dump "$SOURCE_PG_URL" \
  --format=custom \
  --no-owner \
  --file="$DUMP_FILE" \
  2>&1 | tee -a "$TRANSFER_LOG_FILE"
DUMP_EC=${PIPESTATUS[0]}
set -e
if [[ "$DUMP_EC" -ne 0 ]]; then
  transfer_log "FAIL: pg_dump код $DUMP_EC"
  transfer_log_fail "$DUMP_EC"
  exit "$DUMP_EC"
fi
transfer_log "OK: дамп $(ls -lh "$DUMP_FILE" 2>&1)"

transfer_log "Крок 2/2: pg_restore на ціль"
set +e
pg_restore \
  --dbname="$TARGET_PG_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --verbose \
  "$DUMP_FILE" \
  2>&1 | tee -a "$TRANSFER_LOG_FILE"
REST_EC=${PIPESTATUS[0]}
set -e
if [[ "$REST_EC" -ne 0 ]]; then
  transfer_log "FAIL: pg_restore код $REST_EC"
  transfer_log_fail "$REST_EC"
  exit "$REST_EC"
fi

if [[ "${REMOVE_DUMP_AFTER_OK:-}" == "yes" ]]; then
  rm -f "$DUMP_FILE"
  transfer_log "Дамп видалено (REMOVE_DUMP_AFTER_OK=yes)"
else
  transfer_log "Дамп залишено: $DUMP_FILE (щоб прибрати: REMOVE_DUMP_AFTER_OK=yes ...)"
fi

transfer_log "OK: повний перенос завершено"
echo "Готово. Лог: $TRANSFER_LOG_FILE"
