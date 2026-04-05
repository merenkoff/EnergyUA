#!/usr/bin/env bash
# Запуск у контейнері Railway (volume + internal DB). Не покладається на cwd SSH-сесії.
#   railway ssh -s EnergyUA -- bash /app/scripts/railway-media-diagnose.sh
# Якщо /app інший — зайди в ssh, знайди package.json (find / -name package.json 2>/dev/null) і підстав шлях.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NODE_ENV="${NODE_ENV:-production}"
exec ./node_modules/.bin/tsx scripts/cli/media-storage-diagnose.ts
