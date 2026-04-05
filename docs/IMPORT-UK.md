# Імпорт каталогу з in-heat.kiev.ua та et-market.com.ua

> **ВАЖЛИВО (категорії vs товари):** slug-и на кшталт `et-teplyj-pol`, `inh-otoplenie` — це **цільові рядки категорій у вашій БД** для поля `categoryId` товару (мапінг з `sourceCategoryUrl` донора). Вони **не** відтворюють дерево сайту ЕТ/IN-HEAT як окрему навігацію. Усі такі категорії мають батьком **`tepla-pidloga`**. Ключ ідемпотентності товару: **`externalSource` + `externalId`**. Змінюючи мапінг категорій у `scripts/lib/importCategoryMapping.ts`, пам’ятайте: ви перекладаєте товари між **нашими** розділами, а не «імпортуєте дерева».

Коротко: **Docker + PostgreSQL увімкнені**, у корені проєкту є `.env` з `DATABASE_URL`. Далі збираєте JSON парсерами і заливаєте в БД.

## 0. Підготовка (один раз на машину)

```bash
cd /шлях/до/ElectroHeat
docker compose up -d
cp .env.example .env   # якщо ще немає
npx prisma migrate deploy
npm run db:seed        # демо-категорії; потрібна категорія з slug, напр. nagrivalni-maty
```

Переконайтеся, що в БД є **категорія** з тим `slug`, який передасте в імпорт (`--category-slug`). Після `db:seed` є, зокрема, `nagrivalni-maty`.

---

## 1. IN-HEAT — зібрати дані

### Лише список (швидко, без описів і таблиці характеристик)

```bash
npm run parse:in-heat -- --listing-only --out data/scrape/in-heat-list.json
```

### Список + повні картки товарів (опис HTML, фото, характеристики)

```bash
npm run parse:in-heat -- \
  --url "https://in-heat.kiev.ua/ua/otoplenie/teplyy-pol-pod-plitku/nagrevatelnye-maty/" \
  --out data/scrape/in-heat-maty-full.json \
  --detail-limit 19 \
  --delay 400
```

Параметри:

| Параметр | Значення |
|----------|----------|
| `--url` | Сторінка розділу каталогу (за замовчуванням — мати під плитку) |
| `--out` | Куди зберегти JSON |
| `--detail-limit N` | Скільки товарів допарсити повністю (0 = тільки список, якщо без `--listing-only` треба явно поставити 0 або використати `--listing-only`) |
| `--delay` | Пауза між запитами до карток, мс (щоб не навантажувати сервер) |
| `--file path.html` | Замість `--url` — локально збережений HTML |
| `--listing-only` | Не ходити на картки товарів |
| `--all-pages` | Усі сторінки списку категорії (Bitrix `?PAGEN_1=`), без `--file` |

### Усі сторінки однієї категорії

```bash
npm run parse:in-heat -- \
  --url "https://in-heat.kiev.ua/ua/otoplenie/teplyy-pol-pod-plitku/nagrevatelnye-maty/" \
  --all-pages --listing-only --out data/scrape/in-heat-maty-all-pages.json --delay 400
```

### Обхід повного каталогу з меню [in-heat.kiev.ua/ua/](https://in-heat.kiev.ua/ua/)

Скрипт завантажує головну `/ua/`, знімає посилання з `#catalog-menu-dialog`. За замовчуванням обходяться **усі товарні гілки**: `otoplenie`, `termoregulyatory`, `sistema-antiobledeneniya`, `electrotovary`, `tovary` (див. `IN_HEAT_DEFAULT_CATALOG_PREFIXES` у `scripts/parsers/inHeat.ts`). Відкидаються `.html`, `/tag/`, `/filter/`, бренди, блог, сервіси. Є й **сторінки-хаби** з двома сегментами шляху (`/ua/termoregulyatory/`). Для кожної категорії — усі сторінки списку (`PAGEN_1`), товари **без дублікатів** за `sourceUrl` (пріоритет глибшому `sourceCategoryUrl`). У JSON — **`sourceCategoryUrl`** для імпорту.

```bash
npm run parse:in-heat-catalog -- --listing-only --out data/scrape/in-heat-catalog-list.json --delay 400
```

Додаткові параметри:

| Параметр | Значення |
|----------|----------|
| `--seed` | Сторінка з меню (за замовчуванням `https://in-heat.kiev.ua/ua/`) |
| `--prefix` | Префікси через кому; за замовчуванням усі 5 гілок каталогу (див. вище) |
| `--extra-urls path.txt` | Додаткові URL категорій (по одному в рядку), якщо чогось немає в меню |
| `--max-categories N` | Обмежити кількість категорій (тест) |

У JSON поле **`inHeat`**: `categoryUrls`, `perCategory` (сторінок і рядків на категорію), `pathPrefixes`.

**Імпорт:** або **`npm run import:catalog-trees`** (дерево категорій за `sourceCategoryUrl`, розділ 3 нижче), або один JSON у одну категорію через `import:catalog` + `--category-slug`.

---

## 2. ЕТ-МАРКЕТ — зібрати дані

Якщо з **вашого IP** сайт відкривається (інколи з VPN приходить anti-bot):

### Список + усі картки з першої сторінки категорії

```bash
npm run parse:et-category -- \
  --url "https://et-market.com.ua/teplyj-pol/nagrevatelnye-maty/" \
  --out data/scrape/et-maty-full.json \
  --detail-limit 50 \
  --delay 450
```

### Тільки список (без заходу на кожен товар)

```bash
npm run parse:et-category -- --listing-only --out data/scrape/et-list.json
```

### Фільтри бокової панелі (OCFilter) + пагінація

На сторінці категорії на кшталт [Нагрівальні мати](https://et-market.com.ua/teplyj-pol/nagrevatelnye-maty/) парсер знімає блок **«Фильтр»**: ціна (діапазон грн), виробник, площа обігріву, тип, умови монтажу, потужність, країна — з лічильниками товарів і посиланнями `filterUrl` на підфільтр.

- Лише фільтри та метадані (без товарів):

```bash
npm run parse:et-category -- --filters-only --out data/scrape/et-filters.json
```

- Кілька сторінок каталогу (`?page=2` …): унікальні товари об’єднуються в один масив `products`.

```bash
npm run parse:et-category -- --all-pages --listing-only --out data/scrape/et-569-list.json --delay 400
```

- Обмежити кількість сторінок:

```bash
npm run parse:et-category -- --max-pages 5 --listing-only --out data/scrape/et-5p.json
```

У згенерованому JSON поле **`etMarket`** містить:

- `filters` — масив груп з полями `id`, `name`, `values[]` (`label`, `count`, `filterUrl`, `filterKey`); для ціни додатково `priceRangeUah: { min, max }`;
- `pagination` — `currentPage`, `totalPages`, `totalProducts`, `showingFrom`, `showingTo`;
- `pagesScraped` — скільки сторінок списку реально завантажено.

Додатково можна зберегти копію лише фільтрів: `--filters-out path.json`.

### Увесь каталог з головної (теплий пол, терморегулятори, сніготанення, автоматика, кондиціонери тощо)

Скрипт знімає посилання з головної та з хабів (`/teplyj-pol/`, `/termoregulyatory/` …), для **кожного** URL категорії проходить усі сторінки `?page=`, дедуплікує товари (пріоритет «глибшої» категорії замість загального хаба). У JSON є **`etMarketCrawl.perCategory`** (заголовок h1, сторінок, рядків) і **`sourceCategoryUrl`** у кожному товарі.

```bash
npm run parse:et-catalog -- --listing-only --out data/scrape/et-catalog-FULL.json --delay 200
```

Параметр `--max-categories N` — для тесту.

#### Повні картки (опис HTML, галерея, таблиця характеристик)

Після того як є **`et-catalog-FULL.json`** (лише списки), допарс робиться **окремим прогоном** — це **тисячі** HTTP-запитів; бажано стабільна мережа, пауза `--delay 450–600`, за потреби **screen** / **tmux**.

**Один раз «під ключ» (скрипт):** з кореня проєкту

```bash
bash scripts/run-full-detail-import.sh
```

Перед цим мають існувати `data/scrape/et-catalog-FULL.json` та `data/scrape/in-heat-catalog-FULL.json` (див. вище `--listing-only`). Змінні середовища (необов’язково): `DELAY_ET`, `DELAY_IN`, `CHK_ET`, `CHK_IN` (інтервал checkpoint).

**Вручну (ЕТ-маркет):**

```bash
cp data/scrape/et-catalog-FULL.json data/scrape/et-catalog-DETAIL.json
npx tsx scripts/cli/crawl-et-market-catalog.ts \
  --detail-from data/scrape/et-catalog-DETAIL.json \
  --out data/scrape/et-catalog-DETAIL.json \
  --detail-all \
  --checkpoint-every 50 \
  --delay 450
```

**Вручну (IN-HEAT):**

```bash
cp data/scrape/in-heat-catalog-FULL.json data/scrape/in-heat-catalog-DETAIL.json
npx tsx scripts/cli/crawl-in-heat-catalog.ts \
  --detail-from data/scrape/in-heat-catalog-DETAIL.json \
  --out data/scrape/in-heat-catalog-DETAIL.json \
  --detail-all \
  --checkpoint-every 25 \
  --delay 450
```

**Один прогін без копії** (читати listing, писати в інший файл): можна `--detail-from data/scrape/et-catalog-FULL.json --out data/scrape/et-catalog-DETAIL.json --detail-all …`.

**Частинами** (наприклад 500 карток за раз):

```bash
npx tsx scripts/cli/crawl-et-market-catalog.ts \
  --detail-from data/scrape/et-catalog-DETAIL.json \
  --out data/scrape/et-catalog-DETAIL.json \
  --detail-start 0 --detail-end 500 \
  --checkpoint-every 50 --delay 450
# потім --detail-start 500 --detail-end 1000 …
```

Якщо процес обірвався після checkpoint — повторіть ту саму команду з **`--detail-from`** на **той самий** `--out` і вкажіть **`--detail-start`** = наступний індекс після останнього збереженого картки (див. лог `checkpoint`).

**Імпорт після допарсу:**

```bash
npm run import:catalog-trees -- --file data/scrape/et-catalog-DETAIL.json
npm run import:catalog-trees -- --file data/scrape/in-heat-catalog-DETAIL.json
```

Параметри допарсу: `--detail-all` | `--detail-limit N` | `--detail-start` / `--detail-end`, `--checkpoint-every N` (перезапис JSON кожні N карток).

### Якщо з мережі знову «захищена сторінка» / 429

1. Відкрийте категорію в браузері.
2. **Збережіть сторінку** (Ctrl+S / ⌘S) як HTML.
3. Парсинг з файлу:

```bash
npm run parse:et-file -- --file ./збережена-сторінка.html --out data/scrape/et-from-file.json
```

Або:

```bash
npm run parse:et-category -- --file ./збережена-сторінка.html --out data/scrape/et-from-file.json
```

---

## 3. Імпорт JSON у базу ElectroHeat

Файл має бути у форматі **manifest** (масив `products` — так збирають CLI-скрипти вище).

### Дерево категорій (після повного обходу)

Якщо в товарів заповнено **`sourceCategoryUrl`**, імпорт створює **плоску** структуру (як верхнє меню маркету): один рівень під коренем джерела.

```bash
npm run import:catalog-trees -- --file data/scrape/et-catalog-FULL.json
npm run import:catalog-trees -- --file data/scrape/in-heat-catalog-FULL.json
```

Після допарсу карток — файли `*-DETAIL.json`.

- **Корінь вітрини:** усі імпортовані плоскі категорії — **діти `tepla-pidloga`** (на `/catalog` показуються лише такі підрозділи, без окремих карток «ЕТ-маркет» / «IN-HEAT»). Старі корені `et-market-import` / `in-heat-import` після повторного імпорту можна прибрати: `npm run import:prune-legacy-cats`.
- **ЕТ-маркет:** `et-teplyj-pol`, `et-termoregulyatory`, `et-snegotayanie`, `et-avtomatika`, `et-kondicionery`, `et-akvastorozh`, `et-shitovoe-oborudovanie` (перший сегмент шляху `/teplyj-pol/...`).
- **IN-HEAT:** плоскі категорії за другим сегментом шляху `/ua/…`: `inh-otoplenie`, `inh-termoregulyatory`, `inh-sistema-antiobledeneniya`, `inh-electrotovary`, `inh-tovary` (повний обхід — `parse:in-heat-catalog`).
- У товарі в БД зберігаються **`externalUrl`** (URL картки на донорі) та **`sourceCategoryUrl`** (URL розділу) — для аудиту та майбутніх перекласифікацій.
- Головний ключ імпорту без змін: **`externalSource` + `externalId`** (upsert, без дублікатів карток).

Старі глибокі slug `etm-*`, `inh-ua-*` після переходу на плоску схему можна прибрати, якщо вони порожні:

```bash
npm run import:prune-legacy-cats
npm run import:prune-legacy-cats -- --dry-run   # лише показати
```

Перевірка після великого імпорту:

```bash
npm run import:verify
```

Глибоке дерево за повним шляхом URL (старий варіант): **`--deep`** на `import-manifest-categories` (через `npx tsx scripts/cli/import-manifest-categories.ts --deep --file ...`).

**Дублікати ЕТ ↔ IN-HEAT:** після `import:catalog-trees` автоматично викликається зведення схожих назв (Levenshtein): **≥90%** — `merged_into_product_id` на канонічну картку (пріоритет `et_market`), **75–90%** — лише попередження в stderr. Вимкнути: **`--skip-duplicate-reconcile`**. Повтор без імпорту: **`npm run import:reconcile-dupes`** (або `--json` для звіту). Перевірка кандидатів без злиття: **`npm run import:analyze-dupes`**.

### Одна плоска категорія в БД

```bash
npm run import:catalog -- --file data/scrape/et-maty-full.json --category-slug nagrivalni-maty
```

Товари **оновлюються** за парою `externalSource` + `externalId` (повторний запуск не дублює рядки, а перезаписує поля).

Чернетки без публікації на сайті:

```bash
npm run import:catalog -- --file data/scrape/in-heat-maty-full.json --category-slug nagrivalni-maty --draft
```

---

## 4. Перевірка в браузері

```bash
npm run dev
```

Відкрийте `/catalog/nagrivalni-maty` та окремі `/product/...`.

---

## 5. Типові проблеми

| Симптом | Що робити |
|---------|-----------|
| `P1001` / connection refused | `docker compose up -d`, перевірити `DATABASE_URL` |
| Категорія не знайдена | Створити категорію в БД або вказати існуючий `--category-slug` |
| ЕТ-маркет не качається | Вимкнути VPN / зберегти HTML з браузера (п. 2) |
| Дублікат `sku` | У різних джерелах коди не повинні збігатися; для in-heat виправлено читання артикулу з картки товару (не з блоку «схожі») |
| У списку з’явився не товар, а стаття | Парсер списку бере лише посилання на `.html`; зайве можна прибрати з JSON або БД |

---

## 6. Автоматизація пізніше

- **cron** або **GitHub Actions**: `docker compose up` → `migrate deploy` → `parse:…` → `import:catalog`.
- Для ЕТ-маркет при постійному anti-bot — окремий крок з **Playwright** у тій самій мережі, що й ваш ПК, або експорт з адмінки магазину в CSV/XML і окремий імпортер.

Файли парсерів: `scripts/parsers/`, CLI: `scripts/cli/`.
