# Фото товарів із прайсів постачальників

Файли `<sha256>.<jpg|png>` — зображення, вшиті в xlsx-прайси з `data/pricelists/`, витягнуті скриптом
`scripts/pricelists/extract_pricelist_images.py` (`npm run extract:pricelist-images`). `index.json` — для кожного
зображення файл прайсу, аркуш, рядок (1-based) і стовпець (0-based), звідки його взято; за ним `parse_pricelists.py`
прив'язує фото до товарів (`images` у `data/catalog/<постачальник>/<sku>.json`).

Каталог **генерується** — не редагуйте файли вручну. Щоб прибрати логотип/бейдж, додайте перші 10 символів sha256
оригіналу в `BLACKLIST` скрипта; щоб виправити прив'язку — правило в `IMAGE_RULES` у `parse_pricelists.py`.
Після зміни: `npm run extract:pricelist-images && npm run parse:pricelists`.

Імена збігаються з `MEDIA_ROOT` (`sha256` вмісту + розширення): імпорт пише в БД `/api/media/<ім'я>`, файли на volume
копіює `scripts/railway-entrypoint.sh` при старті (локально — імпорт у `storage/media`).
Деталі: `docs/CATALOG-PRICELISTS-UK.md`, розділ «Фото з прайсів».
