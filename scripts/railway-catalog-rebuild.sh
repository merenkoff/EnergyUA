#!/usr/bin/env bash
# Повторний імпорт каталогу з JSON у репозиторії (data/scrape/*) + опційно seed після повного wipe.
# Парсинг сайтів тут НЕ виконується — лише БД. Щоб оновити JSON з донорів, див. docs/IMPORT-UK.md локально.
#
# Змінні:
#   RAILWAY_CATALOG_WIPE_ALL=yes  — видалити всі товари (включно з демо), потім prisma db seed, потім імпорт
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RESET_ARGS=()
if [[ "${RAILWAY_CATALOG_WIPE_ALL:-}" == "yes" ]]; then
  RESET_ARGS=(--wipe-all-products)
  echo "[railway-catalog-rebuild] RAILWAY_CATALOG_WIPE_ALL=yes → усі товари, далі seed"
fi

echo "[railway-catalog-rebuild] Скидання імпортованих даних…"
npx tsx scripts/cli/reset-imported-catalog.ts "${RESET_ARGS[@]}"

if [[ "${RAILWAY_CATALOG_WIPE_ALL:-}" == "yes" ]]; then
  echo "[railway-catalog-rebuild] Відновлення структури seed (tepla-pidloga, демо)…"
  npx prisma db seed
fi

IMPORT_FILES=(
  "data/scrape/et-catalog-DETAIL.json"
  "data/scrape/in-heat-catalog-DETAIL.json"
  "data/scrape/vsesezon-catalog.json"
)

for f in "${IMPORT_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "[railway-catalog-rebuild] Пропуск (немає файлу): $f" >&2
    continue
  fi
  echo "[railway-catalog-rebuild] Імпорт $f …"
  npx tsx scripts/cli/import-manifest-categories.ts --file "$f"
done

echo "[railway-catalog-rebuild] Готово. URL картинок у БД — зовнішні (http/https). На Railway увімкни MIRROR_PRODUCT_IMAGES=yes і MEDIA_ROOT на volume — mirror у railway-entrypoint завантажить файли локально."
