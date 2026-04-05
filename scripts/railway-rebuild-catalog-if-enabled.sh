#!/usr/bin/env bash
# Виклик з Railway pre-deploy: реімпорт лише якщо RAILWAY_REBUILD_CATALOG=yes
set -euo pipefail
if [[ "${RAILWAY_REBUILD_CATALOG:-}" != "yes" ]]; then
  echo "[railway-rebuild] RAILWAY_REBUILD_CATALOG не yes — пропуск реімпорту"
  exit 0
fi
exec bash "$(dirname "$0")/railway-catalog-rebuild.sh"
