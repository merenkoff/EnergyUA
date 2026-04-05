#!/usr/bin/env bash
# Етап 1 (локально): відновити out/electroheat.dump на віддалену БД (Railway тощо)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DUMP_FILE="$ROOT/scripts/one-time-db-transfer/out/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-transfer-log.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-url.sh"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-pg-bin.sh"

cd "$ROOT"
transfer_log_init "restore-to-remote.sh"
trap 'ec=$?; [[ $ec -ne 0 ]] && transfer_log_fail "$ec"; exit "$ec"' ERR

transfer_log "Крок: перевірка pg_restore"
PG_RESTORE_EXE="$(resolve_pg_restore)" || true
if [[ -z "$PG_RESTORE_EXE" || ! -x "$PG_RESTORE_EXE" ]]; then
  transfer_log "FAIL: немає pg_restore. macOS: brew install postgresql@16"
  echo "Потрібен pg_restore тієї ж або новішої major-версії, ніж сервер. macOS: brew install postgresql@16" >&2
  exit 1
fi
transfer_log "pg_restore: $PG_RESTORE_EXE — $("$PG_RESTORE_EXE" --version 2>&1)"

if [[ ! -f "$DUMP_FILE" ]]; then
  transfer_log "FAIL: немає файлу дампу $DUMP_FILE"
  echo "Немає $DUMP_FILE — спочатку запусти dump-from-local.sh" >&2
  exit 1
fi

transfer_log "Розмір дампу: $(ls -lh "$DUMP_FILE" 2>&1)"

if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  transfer_log "FAIL: не задано TARGET_DATABASE_URL"
  echo "Задай TARGET_DATABASE_URL (connection string продакшен-Postgres, зазвичай з sslmode=require)." >&2
  exit 1
fi

if [[ "${REALLY_REPLACE_REMOTE:-}" != "yes" ]]; then
  transfer_log "Скасовано: потрібно REALLY_REPLACE_REMOTE=yes"
  echo "Це ПЕРЕЗАПИШЕ дані на TARGET_DATABASE_URL. Для підтвердження:" >&2
  echo "  REALLY_REPLACE_REMOTE=yes TARGET_DATABASE_URL='...' $0" >&2
  exit 1
fi

transfer_log "Ціль (URL з прихованим паролем): $(transfer_mask_url "$TARGET_DATABASE_URL")"
TARGET_PG_URL="$(pg_url_for_libpq "$TARGET_DATABASE_URL")"
transfer_log "Крок: pg_restore --clean --if-exists --no-owner --no-acl --verbose (URI без Prisma schema=)"

set +e
"$PG_RESTORE_EXE" \
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
  transfer_log "FAIL: pg_restore завершився з кодом $REST_EC (інколи частина WARNING допустима — див. лог)"
  transfer_log_fail "$REST_EC"
  exit "$REST_EC"
fi

transfer_log "OK: відновлення завершено без помилки pg_restore"
transfer_log "Перевір застосунок; Prisma _prisma_migrations має збігатися з дампом."
echo "Готово. Лог: $TRANSFER_LOG_FILE"
