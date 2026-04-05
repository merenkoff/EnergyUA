#!/usr/bin/env bash
# Старт на Railway: Volume уже змонтований у MEDIA_ROOT — тут безпечно кешувати фото.
# Pre-deploy часто пише в ephemeral FS, тому mirror перенесено сюди (див. docs/MEDIA-STORAGE.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NODE_ENV="${NODE_ENV:-production}"

if [[ "${MIRROR_PRODUCT_IMAGES:-}" == "yes" ]]; then
  echo "[railway-entrypoint] MIRROR_PRODUCT_IMAGES=yes → mirror-product-images.ts"
  npx tsx scripts/cli/mirror-product-images.ts
fi

exec ./node_modules/.bin/next start
