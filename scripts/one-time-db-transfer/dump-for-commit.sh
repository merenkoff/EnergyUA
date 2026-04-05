#!/usr/bin/env bash
# Локально: зняти дамп у committed-dump/electroheat.sql (plain SQL) — для ОДНОГО коміту, потім видалити.
# Plain SQL відновлюється через psql; custom (.dump) на Railway часто ламається (pg_restore 15 vs архів v1.15 від pg_dump 16).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST_DIR="$ROOT/scripts/one-time-db-transfer/committed-dump"
SQL_FILE="$DEST_DIR/electroheat.sql"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-transfer-log.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-bin.sh"

cd "$ROOT"
transfer_log_init "dump-for-commit.sh"
trap 'ec=$?; [[ $ec -ne 0 ]] && transfer_log_fail "$ec"; exit "$ec"' ERR

transfer_log "УВАГА: дамп може містити персональні дані / внутрішню інформацію — не публікуй репо публічно без оцінки ризику."

PG_DUMP_EXE="$(resolve_pg_dump)" || true
if [[ -z "$PG_DUMP_EXE" || ! -x "$PG_DUMP_EXE" ]]; then
  transfer_log "FAIL: немає pg_dump. macOS: brew install postgresql@16 (клієнт має бути ≥ major версії сервера)"
  exit 1
fi
transfer_log "pg_dump бінарник: $PG_DUMP_EXE ($("$PG_DUMP_EXE" --version 2>&1))"

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
rm -f "$SQL_FILE" "$DEST_DIR/electroheat.dump"

transfer_log "pg_dump → $SQL_FILE (plain SQL, --clean --if-exists для одноразового перезапису на цілі)"
set +e
"$PG_DUMP_EXE" "$SOURCE_PG_URL" \
  --format=plain \
  --no-owner \
  --clean \
  --if-exists \
  --file="$SQL_FILE" \
  2>&1 | tee -a "$TRANSFER_LOG_FILE"
EC=${PIPESTATUS[0]}
set -e
if [[ "$EC" -ne 0 ]]; then
  transfer_log "FAIL: pg_dump $EC"
  transfer_log_fail "$EC"
  exit "$EC"
fi

SZ=$(wc -c <"$SQL_FILE" | tr -d ' ')
transfer_log "OK: $(ls -lh "$SQL_FILE") байт=$SZ"
if [[ "$SZ" -gt 90000000 ]]; then
  transfer_log "Попередження: >~90 MiB — на GitHub ліміт 100 MiB; розглянь Git LFS або стиснення окремим кроком."
fi

echo ""
echo "Далі:"
echo "  1) git add scripts/one-time-db-transfer/committed-dump/electroheat.sql"
echo "  2) Закоміть; у Railway: IMPORT_COMMITTED_DUMP=yes (і postgresql-client у образі — railpack.json)."
echo "  3) Після успіху: прибери IMPORT_COMMITTED_DUMP, видали electroheat.sql і скрипти."
echo "Лог: $TRANSFER_LOG_FILE"
