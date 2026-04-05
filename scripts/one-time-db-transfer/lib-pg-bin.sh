#!/usr/bin/env bash
# pg_dump/pg_restore з PATH часто старіші за сервер (наприклад libpq 15 vs Postgres 16).
# Порядок: PG_DUMP_BIN / PG_RESTORE_BIN → Homebrew postgresql@17/@16 → libpq → which.

resolve_pg_dump() {
  if [[ -n "${PG_DUMP_BIN:-}" ]]; then
    printf '%s' "$PG_DUMP_BIN"
    return 0
  fi
  local p
  for p in \
    /opt/homebrew/opt/postgresql@17/bin/pg_dump \
    /opt/homebrew/opt/postgresql@16/bin/pg_dump \
    /usr/local/opt/postgresql@17/bin/pg_dump \
    /usr/local/opt/postgresql@16/bin/pg_dump \
    /opt/homebrew/opt/libpq/bin/pg_dump \
    /usr/local/opt/libpq/bin/pg_dump; do
    [[ -x "$p" ]] && { printf '%s' "$p"; return 0; }
  done
  command -v pg_dump 2>/dev/null && return 0
  return 1
}

resolve_pg_restore() {
  if [[ -n "${PG_RESTORE_BIN:-}" ]]; then
    printf '%s' "$PG_RESTORE_BIN"
    return 0
  fi
  local p
  for p in \
    /opt/homebrew/opt/postgresql@17/bin/pg_restore \
    /opt/homebrew/opt/postgresql@16/bin/pg_restore \
    /usr/local/opt/postgresql@17/bin/pg_restore \
    /usr/local/opt/postgresql@16/bin/pg_restore \
    /opt/homebrew/opt/libpq/bin/pg_restore \
    /usr/local/opt/libpq/bin/pg_restore; do
    [[ -x "$p" ]] && { printf '%s' "$p"; return 0; }
  done
  command -v pg_restore 2>/dev/null && return 0
  return 1
}

resolve_psql() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    printf '%s' "$PSQL_BIN"
    return 0
  fi
  local p
  for p in \
    /opt/homebrew/opt/postgresql@17/bin/psql \
    /opt/homebrew/opt/postgresql@16/bin/psql \
    /usr/local/opt/postgresql@17/bin/psql \
    /usr/local/opt/postgresql@16/bin/psql \
    /opt/homebrew/opt/libpq/bin/psql \
    /usr/local/opt/libpq/bin/psql; do
    [[ -x "$p" ]] && { printf '%s' "$p"; return 0; }
  done
  command -v psql 2>/dev/null && return 0
  return 1
}
