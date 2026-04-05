#!/usr/bin/env bash
# Якщо MIRROR_PRODUCT_IMAGES=yes — дзеркалить зовнішні фото (Railway: один деплой, потім прибрати змінну).
set -euo pipefail
if [[ "${MIRROR_PRODUCT_IMAGES:-}" == "yes" ]]; then
  echo "[mirror-product-images] MIRROR_PRODUCT_IMAGES=yes — запуск mirror-product-images.ts"
  exec npx tsx scripts/cli/mirror-product-images.ts
fi
