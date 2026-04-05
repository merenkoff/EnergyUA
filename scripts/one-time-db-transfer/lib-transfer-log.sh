#!/usr/bin/env bash
# Тимчасове логування для етапу 1 — на етапі 2 всю папку one-time-db-transfer видаляють.
# Лог: scripts/one-time-db-transfer/out/last-transfer.log (у .gitignore).

transfer_log_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/out"
mkdir -p "$transfer_log_dir"
TRANSFER_LOG_FILE="${TRANSFER_LOG_FILE:-$transfer_log_dir/last-transfer.log}"

transfer_log_init() {
  local script_name="$1"
  {
    echo "========================================"
    echo "ElectroHeat DB transfer log"
    echo "Script: $script_name"
    echo "Started (local): $(date -Iseconds)"
    echo "Host: $(uname -s 2>/dev/null || echo unknown) $(uname -m 2>/dev/null || echo)"
    echo "========================================"
  } >"$TRANSFER_LOG_FILE"
}

transfer_mask_url() {
  local u="${1:-}"
  if [[ -z "$u" ]]; then
    echo "(empty)"
    return
  fi
  echo "$u" | sed -E 's#(postgres(ql)?://[^:/@]+:)[^@]*@#\1***@#'
}

transfer_log() {
  local ts line
  ts=$(date -Iseconds)
  line="[$ts] $*"
  echo "$line" | tee -a "$TRANSFER_LOG_FILE"
}

transfer_log_fail() {
  local code="${1:-?}"
  transfer_log "ERROR: exit code $code"
  transfer_log "Надішли цей файл асистенту: $TRANSFER_LOG_FILE"
  echo "" >&2
  echo "Щось пішло не так. Повний лог (можна передати в чат):" >&2
  echo "  $TRANSFER_LOG_FILE" >&2
}
