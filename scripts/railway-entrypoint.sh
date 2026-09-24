#!/usr/bin/env bash
# Старт на Railway: Volume уже змонтований у MEDIA_ROOT — тут безпечно кешувати фото.
# Pre-deploy часто пише в ephemeral FS, тому mirror перенесено сюди (див. docs/MEDIA-STORAGE.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NODE_ENV="${NODE_ENV:-production}"

# Mirror іде у фоні паралельно з next start: healthcheck не чекає тисячі завантажень,
# а кожен рядок product_images переключається на /api/media/… лише після того, як файл уже на диску.
# Донор за Cloudflare (in-heat) не віддає фото ні контейнеру, ні CI — mirror на них отримує 403.
# Тому їхні файли лежать у репозиторії архівом і розпаковуються на volume при старті.
# tar -k не чіпає вже наявні, тож повторний деплой нічого не перезаписує.
MEDIA_SEED_DIR="${MEDIA_SEED_DIR:-data/media-seed}"
if [[ -d "$MEDIA_SEED_DIR" ]] && compgen -G "$MEDIA_SEED_DIR/*.tgz" > /dev/null; then
  TARGET="${MEDIA_ROOT:-storage/media}"
  mkdir -p "$TARGET"
  for archive in "$MEDIA_SEED_DIR"/*.tgz; do
    echo "[railway-entrypoint] media-seed: $archive → $TARGET"
    tar xzkf "$archive" -C "$TARGET" 2>/dev/null || true
  done
  echo "[railway-entrypoint] файлів у $TARGET: $(find "$TARGET" -maxdepth 1 -type f ! -name '.*' | wc -l | tr -d ' ')"
fi

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
