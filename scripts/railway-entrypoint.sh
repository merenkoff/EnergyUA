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

# Стирання підпису донора з файлів фото. Іде після mirror: спершу файли мають опинитися на volume.
# Оригінали лишаються в MEDIA_ORIGINALS_ROOT, повернути їх можна прогоном з --restore.
dewatermark() {
  if [[ "${DEWATERMARK_IMAGES:-}" != "yes" ]]; then
    return 0
  fi
  echo "[railway-entrypoint] DEWATERMARK_IMAGES=yes → remove-image-watermarks.ts --apply"
  if npx tsx scripts/cli/remove-image-watermarks.ts --apply; then
    echo "[railway-entrypoint] стирання підпису завершено"
  else
    echo "[railway-entrypoint] стирання підпису завершилося з помилкою (фото лишаються як були)" >&2
  fi
}

# Фото з прайсів постачальників (data/catalog-media/<sha256>.<ext>) — у БД вони вже записані як /api/media/…
# імпортом у pre-deploy; сам файл кладемо на volume тут, бо в pre-deploy volume не змонтований.
CATALOG_MEDIA_DIR="${CATALOG_MEDIA_DIR:-data/catalog-media}"
if [[ -d "$CATALOG_MEDIA_DIR" ]]; then
  TARGET="${MEDIA_ROOT:-storage/media}"
  mkdir -p "$TARGET"
  copied=0
  for f in "$CATALOG_MEDIA_DIR"/*.jpg "$CATALOG_MEDIA_DIR"/*.png; do
    [[ -f "$f" ]] || continue
    if [[ ! -e "$TARGET/$(basename "$f")" ]]; then
      cp "$f" "$TARGET/" && copied=$((copied + 1))
    fi
  done
  echo "[railway-entrypoint] catalog-media → $TARGET: скопійовано $copied нових"
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
    dewatermark
  ) &
elif [[ "${DEWATERMARK_IMAGES:-}" == "yes" ]]; then
  ( dewatermark ) &
fi

exec ./node_modules/.bin/next start
