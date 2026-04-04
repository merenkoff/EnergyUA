#!/usr/bin/env bash
# Повний допарс карток + імпорт у дерево категорій (ЕТ-маркет, потім IN-HEAT).
# Запуск з кореня репозиторію: bash scripts/run-full-detail-import.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DELAY_ET="${DELAY_ET:-450}"
DELAY_IN="${DELAY_IN:-450}"
CHK_ET="${CHK_ET:-50}"
CHK_IN="${CHK_IN:-25}"

ET_LIST="data/scrape/et-catalog-FULL.json"
ET_DETAIL="data/scrape/et-catalog-DETAIL.json"
IN_LIST="data/scrape/in-heat-catalog-FULL.json"
IN_DETAIL="data/scrape/in-heat-catalog-DETAIL.json"

for f in "$ET_LIST" "$IN_LIST"; do
  if [[ ! -f "$f" ]]; then
    echo "Немає $f — спочатку зніміть списки:"
    echo "  npm run parse:et-catalog -- --listing-only --out $ET_LIST --delay 200"
    echo "  npm run parse:in-heat-catalog -- --listing-only --out $IN_LIST --delay 400"
    exit 1
  fi
done

echo "=== 1/4 Копія listing → робочий файл для ЕТ (можна перезапустити з цього ж файлу) ==="
cp -f "$ET_LIST" "$ET_DETAIL"

echo "=== 2/4 Допарс усіх карток ЕТ-маркет (довго; checkpoint кожні $CHK_ET) ==="
npx tsx scripts/cli/crawl-et-market-catalog.ts \
  --detail-from "$ET_DETAIL" \
  --out "$ET_DETAIL" \
  --detail-all \
  --checkpoint-every "$CHK_ET" \
  --delay "$DELAY_ET"

echo "=== 3/4 IN-HEAT: копія + допарс ==="
cp -f "$IN_LIST" "$IN_DETAIL"
npx tsx scripts/cli/crawl-in-heat-catalog.ts \
  --detail-from "$IN_DETAIL" \
  --out "$IN_DETAIL" \
  --detail-all \
  --checkpoint-every "$CHK_IN" \
  --delay "$DELAY_IN"

echo "=== 4/4 Імпорт у PostgreSQL ==="
npm run import:catalog-trees -- --file "$ET_DETAIL"
npm run import:catalog-trees -- --file "$IN_DETAIL"

echo "Готово. Файли: $ET_DETAIL , $IN_DETAIL"
