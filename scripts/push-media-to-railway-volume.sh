#!/usr/bin/env bash
# Локальний storage/media → volume на Railway (через stdin у railway ssh).
# Потрібен повний локальний каталог з тими самими іменами файлів, що в БД (/api/media/{sha256}.ext).
#
#   npm run db:push-media-railway
#   RAILWAY_REMOTE_MEDIA_ROOT=/data/media npm run db:push-media-railway -- OtherService
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-EnergyUA}"
REMOTE_ROOT="${RAILWAY_REMOTE_MEDIA_ROOT:-/data/media}"

cd "$ROOT"
if [ ! -d storage/media ]; then
  echo "Немає каталогу storage/media" >&2
  exit 1
fi
if ! find storage/media -maxdepth 1 -type f 2>/dev/null | head -1 | grep -q .; then
  echo "storage/media порожній — спочатку npm run db:mirror-images локально або скопіюй файли." >&2
  exit 1
fi

echo "Архів storage/media → railway ssh -s ${SERVICE} → ${REMOTE_ROOT}"
echo "(якщо обрив або таймаут — спробуй менший набір або повтори; великі каталоги можуть йти хвилини)"
tar czf - -C storage/media . | railway ssh -s "$SERVICE" -- sh -c "mkdir -p \"$REMOTE_ROOT\" && tar xzf - -C \"$REMOTE_ROOT\""

echo "Готово. Перевір: railway ssh -s $SERVICE -- bash /app/scripts/railway-media-diagnose.sh"
