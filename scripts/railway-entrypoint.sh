#!/usr/bin/env bash
# Старт на Railway: Volume уже змонтований у MEDIA_ROOT — тут безпечно кешувати фото.
# Pre-deploy часто пише в ephemeral FS, тому mirror перенесено сюди (див. docs/MEDIA-STORAGE.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NODE_ENV="${NODE_ENV:-production}"

# Mirror іде у фоні паралельно з next start: healthcheck не чекає тисячі завантажень,
# а кожен рядок product_images переключається на /api/media/… лише після того, як файл уже на диску.
if [[ "${MIRROR_PRODUCT_IMAGES:-}" == "yes" ]]; then
  echo "[railway-entrypoint] MIRROR_PRODUCT_IMAGES=yes → mirror-product-images.ts у фоні"
  (
    # Недокачані тимчасові файли від попереднього контейнера, який зупинили посеред mirror
    # (volume змонтований лише в один активний деплой, тож паралельного mirror тут немає).
    find "${MEDIA_ROOT:-storage/media}" -maxdepth 1 -name '.tmp-*' -delete 2>/dev/null || true
    if npx tsx scripts/cli/mirror-product-images.ts; then
      echo "[railway-entrypoint] mirror завершено"
    else
      echo "[railway-entrypoint] mirror завершився з помилкою (сайт працює, фото лишаються зовнішніми URL)" >&2
    fi
  ) &
fi

exec ./node_modules/.bin/next start
