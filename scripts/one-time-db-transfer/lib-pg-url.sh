#!/usr/bin/env bash
# Prisma додає до DATABASE_URL параметр ?schema= — pg_dump/pg_restore (libpq) його не приймають.
pg_url_for_libpq() {
  local u="$1"
  printf '%s' "$u" | sed -E \
    -e 's/\?schema=[^&]*&/?/' \
    -e 's/\?schema=[^&]*$//' \
    -e 's/&schema=[^&]*//'
}
