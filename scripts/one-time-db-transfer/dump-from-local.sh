#!/usr/bin/env bash
# Етап 1 (локально): зняти повний дамп локальної БД у out/electroheat.dump
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT/scripts/one-time-db-transfer/out"
DUMP_FILE="$OUT_DIR/electroheat.dump"
# shellcheck source=/dev/null
source "$ROOT/scripts/one-time-db-transfer/lib-transfer-log.sh"

cd "$ROOT"
transfer_log_init "dump-from-local.sh"
trap 'ec=$?; [[ $ec -ne 0 ]] && transfer_log_fail "$ec"; exit "$ec"' ERR

transfer_log "Крок: перевірка pg_dump"
if ! command -v pg_dump >/dev/null 2>&1; then
  transfer_log "FAIL: pg_dump не знайдено в PATH"
  echo "Потрібен pg_dump (PostgreSQL client). macOS: brew install libpq && brew link --force libpq" >&2
  exit 1
fi
transfer_log "pg_dump: $(pg_dump --version 2>&1)"

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    transfer_log "Крок: читаю .env для DATABASE_URL"
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  else
    transfer_log "Файл .env не знайдено (це ок, якщо задано SOURCE_DATABASE_URL)"
  fi
fi

if [[ -z "${SOURCE_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  SOURCE_DATABASE_URL="$DATABASE_URL"
fi

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
  transfer_log "FAIL: немає SOURCE_DATABASE_URL / DATABASE_URL"
  echo "Задай SOURCE_DATABASE_URL або поклади DATABASE_URL у .env у корені проєкту." >&2
  exit 1
fi

transfer_log "Джерело (URL з прихованим паролем): $(transfer_mask_url "$SOURCE_DATABASE_URL")"

mkdir -p "$OUT_DIR"
rm -f "$DUMP_FILE"

transfer_log "Крок: pg_dump → $DUMP_FILE (custom format)"
set +e
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --file="$DUMP_FILE" \
  2>&1 | tee -a "$TRANSFER_LOG_FILE"
DUMP_EC=${PIPESTATUS[0]}
set -e

if [[ "$DUMP_EC" -ne 0 ]]; then
  transfer_log "FAIL: pg_dump завершився з кодом $DUMP_EC"
  transfer_log_fail "$DUMP_EC"
  exit "$DUMP_EC"
fi

transfer_log "OK: дамп створено"
ls -lh "$DUMP_FILE" 2>&1 | tee -a "$TRANSFER_LOG_FILE"
transfer_log "Файл дампу: $DUMP_FILE (не комітити). Лог: $TRANSFER_LOG_FILE"
echo "Готово: $DUMP_FILE"
echo "Лог: $TRANSFER_LOG_FILE"
