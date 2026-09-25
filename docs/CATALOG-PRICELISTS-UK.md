# Каталог з прайсів постачальників

Новий каталог сайту будується не з сайтів-донорів, а з прайсів, які надсилають постачальники.
Старий каталог (et_market / in_heat / vsesezon) переведено в **архів**: усі його товари мають
`archived = true` і не показуються, поки прапорець не знято в адмінці; його категорії живуть під коренем «Архів».

## Потік даних

```
data/pricelists/*.xlsx|docx|pdf        сирі прайси (комітяться)
        │  npm run extract:pricelist-images   scripts/pricelists/extract_pricelist_images.py (Python)
        ▼
data/catalog-media/<sha256>.<ext> + index.json   фото, вшиті в xlsx (комітяться, генеруються)
data/catalog-media/external-sources.json         правила «артикул → URL фото на сайті бренду» (вручну)
        │  npm run fetch:brand-images  scripts/pricelists/fetch_external_images.py → external.json + файли
        ▼
        │  npm run parse:pricelists    scripts/pricelists/parse_pricelists.py (Python, читає index.json + external*.json)
        ▼
data/catalog/<постачальник>/<sku>.json  один файл = один товар (комітяться, генеруються)
        │  npm run import:pricelists   scripts/cli/import-pricelist-catalog.ts (tsx)
        ▼
PostgreSQL: products / product_specs / product_tags / product_images / categories / brands / tags
        │  scripts/railway-entrypoint.sh (start)   копіює data/catalog-media/*.jpg|png у MEDIA_ROOT
        ▼
/api/media/<sha256>.<ext>
```

- `db:predeploy` = `prisma migrate deploy` → `prisma db seed` → `import:pricelists`. Отже, коміт нового JSON = оновлені ціни після деплою.
- Ключ товару в БД: `externalSource = "pricelist"`, `externalId = "<постачальник>/<sku-slug>"`. Slug URL створюється один раз і далі не змінюється.
- Товари, яких у файлах більше немає, імпорт **знімає з публікації** (`published = false`), не видаляє.
- SKU в БД унікальний: якщо однаковий артикул є у двох постачальників, другий отримує суфікс `[<постачальник>]`.

## Як додати або оновити прайс

1. Покласти файл у `data/pricelists/` з іменем `YYYY-MM-DD-<постачальник>.<ext>`, дописати рядок у `data/pricelists/README.md`.
2. Якщо це той самий постачальник і та сама розмітка — поправити ім'я файлу та дату у відповідній функції `parse_<supplier>()`.
   Якщо розмітка інша або постачальник новий — дописати функцію-парсер і зареєструвати її в `PARSERS`.
3. `pip install openpyxl python-docx pdfplumber pillow` (один раз). Якщо це xlsx з фото — спершу `npm run extract:pricelist-images`
   (див. «Фото з прайсів» нижче), потім `npm run parse:pricelists` (або `--only <ключ>`).
   Скрипт друкує кількість товарів, скільки з них з фото, і попередження (дублі артикулів, невідомі бренди).
4. Переглянути diff у `data/catalog/…`, за потреби поправити парсер, закомітити.
5. Локально: `npm run import:pricelists`. На Railway імпорт виконається сам у pre-deploy.

Slug-и розділів, міток і брендів у JSON перевіряються імпортером проти `scripts/lib/pricelistTaxonomy.ts`;
невідомий slug — помилка імпорту (щоб каталог не «розповзався»). Парсер читає ці ж slug-и з TS-файлу.

## Формат файлу товару

```jsonc
{
  "id": "in-therm/dr-150w",            // = externalId
  "supplier": "in-therm",
  "brand": "hemstedt",                 // slug з BRANDS або null
  "sku": "DR 150W",
  "nameUk": "Нагрівальний кабель Hemstedt DR 12,5 Вт/м — 12 м, 150 Вт",
  "category": "nahrivalnyi-kabel",     // slug розділу з CATALOG_SECTIONS
  "tags": ["pid-plytku", "tonkyi-kabel", "dvozhylnyi", "12-5-vt-m", "nimechchyna", "z-komplektom"],
  "priceUah": 4860, "priceKitUah": 5040, "priceUnit": "шт", "priceNote": null,
  "shortDescription": null, "description": "<ul><li>…</li></ul><p>…</p>",
  "specs": [{ "slug": "power_w", "labelUk": "Потужність", "value": "150", "number": 150, "unit": "Вт" }],
  "images": [{ "file": "d6cc2b47ae….jpg", "alt": "Нагрівальний кабель Hemstedt DR …" }],  // файли з data/catalog-media/
  "source": { "file": "data/pricelists/2026-08-13-in-therm.xlsx", "sheet": "HEMSTEDT", "date": "2026-08-13" }
}
```

## Розділи (категорії) і мітки

Розділ — «папка» товару, одна на товар. Мітка — довільна кількість на товар; одна й та сама позиція
видна в кількох зрізах одночасно (наприклад, кабель 30 Вт/м: розділ «Сніготанення», мітки «водостоки та покрівля»,
«відкриті майданчики», «двожильний», «30 Вт/м», «Чехія»).

Розділи під коренем `katalog`: нагрівальні мати · нагрівальний кабель · під ламінат і паркет (алюмінієві мати,
мати у фользі, плівка) · терморегулятори · саморегулюючий кабель · сніготанення та антиобледеніння · датчики та
монтажні матеріали · рушникосушарки · інфрачервоні обігрівачі · килимки з підігрівом · інвертори, акумулятори,
зарядні станції · захист від протікання · заземлення.

Групи міток: **застосування** (під плитку, під ламінат, у стяжку, відкриті майданчики, водостоки та покрівля, труби…),
**конструкція** (двожильний, одножильний, тонкий, ультратонкий, самоклеюча сітка, алюмінієвий мат, плівка,
з вбудованим термостатом, відрізний, фторопластова ізоляція, безмуфтове з’єднання), **функції терморегуляторів**
(механічний, цифровий, програмований, сенсорний, Wi-Fi, Zigbee, DIN-рейка, двозонний, датчик підлоги/повітря…),
**потужність** (140…400 Вт/м², 10…30 Вт/м), **країна**, **комплектація** (є ціна комплекту, акція, під замовлення).

На сайті: розділ `/catalog/<slug>` показує мітки товарів розділу з кількістю і дозволяє звужувати список
(`?tag=pid-plytku,nimechchyna` — усі вибрані мітки одночасно); сторінка `/tag/<slug>` збирає товари з міткою
з усіх розділів; на картці товару мітки — посилання.

## Бренди та джерела фото/описів (етап 2)

| Бренд | Країна | Офіційне джерело |
|-------|--------|------------------|
| Hemstedt | Німеччина | hemstedt.de |
| Fenix | Чехія | fenixgroup.cz (галерея об'єктів, інструкції) |
| IN-THERM | Чехія / Китай | in-therm.ua |
| Nexans | Норвегія | nexans.com |
| Arnold Rak, Extherm | Німеччина | arnold-rak.de, extherm.com.ua |
| Magnum (C&F Technics) | Нідерланди | magnumheating.com |
| Profi Therm, Wärme, Easytherm, Terneo | Україна / Польща | profitherm.ua, warme.com.ua, easytherm.com.ua, terneo.ua |
| Eberle, OJ Electronics | Німеччина, Данія | eberle.de, ojelectronics.com |
| Deye, Bluetti, Bluesun | Китай | deyeinverter.com, bluettipower.eu, bluesunpv.com |

Повний список зі slug-ами — `BRANDS` у `scripts/lib/pricelistTaxonomy.ts`.

## Фото з прайсів (етап 2)

Чотири xlsx (In-Therm, Heat Plus, РД, Easytherm/Extherm/Hot Fly) містять фото товарів як вбудовані зображення,
прив'язані до клітинки. `npm run extract:pricelist-images` (`scripts/pricelists/extract_pricelist_images.py`) витягує їх у
`data/catalog-media/<sha256>.<ext>` і пише `data/catalog-media/index.json` — для кожного зображення файл прайсу, аркуш,
рядок (1-based) і стовпець (0-based). Ім'я файлу таке саме, як у `MEDIA_ROOT` (`sha256` вмісту + розширення), тому
файл можна просто скопіювати на volume, а в БД одразу записати `/api/media/<ім'я>`. Великі фото зменшуються до 1200 px
по більшій стороні; логотипи, бейджі («Wi-Fi», «Новинка»), схеми, графіки й банери відсіюються чорним списком
`BLACKLIST` (перші 10 символів sha256 оригіналу) і порогом `MIN_SIDE`.

Парсер (`parse_pricelists.py`) читає індекс через `ImageIndex` і прив'язує фото так:

- **рядкові прайси** (Heat Plus, РД, Easytherm, In-Therm) — фото в тому ж рядку, що й товар (`MEDIA.at(файл, аркуш, рядок)`);
- **блоки In-Therm** (заголовок, під ним кілька рядків-модифікацій) — усі фото між заголовком і кінцем блоку
  (`MEDIA.in_rows`), а якщо їх немає — файли за хешем із `IT_BLOCKS[...]["images"]`;
- **стовпчикові таблиці** термостатів In-Therm — фото в рядках 1–2 / 30–31 / 49–50 того ж стовпця, що й модель;
- **ручні правила** `IMAGE_RULES[<постачальник>]` — список `(префікс артикула або назви, [хеші])`, перше збігання виграє.
  Потрібні там, де фото стоїть на рядок вище/нижче товару або одне на групу (РД: TXLP, MILLIMAT, Wärme, Profi Therm,
  Profitherm-MEX білий/чорний; Easytherm: термостати 5551x–5553x).

У JSON товару це поле `images: [{ file, alt }]`. Імпортер перевіряє, що файл існує в `data/catalog-media/` і має безпечне ім'я,
пише рядки `product_images` з `url = /api/media/<файл>`, `sourceUrl = pricelist:<файл>` і замінює лише «свої» рядки
(з таким `sourceUrl`), не чіпаючи фото, завантажені через адмінку. Наприкінці імпорт копіює файли в `MEDIA_ROOT`
(локально — `storage/media`); на Railway volume у pre-deploy не змонтований, тому копіює `railway-entrypoint.sh` при старті
(лише відсутні файли).

### Фото з сайтів брендів

У прайсах Arnold Rak / Ryxon / Flex, Magnum, Shtoller, SMART і в частині Easytherm / Extherm / Hot Fly фото немає.
Для них джерело — офіційні сайти брендів (або їхніх дистриб'юторів в Україні), описані вручну в
`data/catalog-media/external-sources.json`:

```jsonc
{ "supplier": "ar-ryxon-flex", "brand": "ryxon",
  "match": { "skuPrefix": ["HM-200-"] },          // або { "sku": ["LSR-17-CR", …] } — точні артикули
  "urls": ["https://www.ryxon.eu/…/heating_mats.jpg",
           { "url": "https://extherm.com.ua/img/EM_1.jpg", "cropBottom": 0.1 }],  // відрізати підпис знизу
  "page": "https://www.ryxon.eu/products/heating-mats", "note": "…" }
```

`npm run fetch:brand-images` (`scripts/pricelists/fetch_external_images.py`) завантажує кожен URL, зменшує до 1200 px
(webp → jpg/png; важкий PNG з прозорістю → JPEG на білому тлі), кладе в `data/catalog-media/<sha256>.<ext>` і пише
`external.json` (URL → файл). Парсер підставляє ці файли товару, **якщо фото з прайсу не знайшлося**: спершу точний
артикул, далі найдовший префікс. Записи з порожнім `urls` — «шукали, не знайшли», з приміткою чому.

Звідки взято: Ryxon — ryxon.eu; Arnold Rak — arnoldrak.com.ua і rak-waermetechnik.de (arnold-rak.de недоступний);
Flex — офіційного сайту немає, використано фото Ryxon без брендування (той самий завод); Easytherm / Extherm / Hot Fly —
YML-фід імпортера Onteplo (`extherm.com.ua/img/…`, знизу відрізано підпис «brand by Onteplo») + сторінки extherm.com.ua
та hot-fly.com.ua; Magnum і Heat Wave (MHW) — magnum-heating.com.ua, magnumheating.com, kkplus.shop; Terneo —
ds-electronics.com.ua (виробник); OJ Electronics — ojelectronics.com; HTS — hts-global.com (лише технічні рендери);
Shtoller — shtoller.ua; Nexans DEFROST — nexans.no (DAM-рендери); Heat Plus — heatplus.ua; Bluetti — bluettipower.eu;
Fenix ECOSUN S+ — рендер із fenixgroup.cz (сайт блокує автоматичні запити капчею, тому файл додано з локальної копії).

Покриття після етапу 2 (товарів з фото / усього): In-Therm 447/450, Heat Plus 65/67, РД 184/196,
Easytherm/Extherm/Hot Fly 168/168, Arnold Rak/Ryxon/Flex 195/208, Magnum 109/120, Shtoller 36/36, SMART 2/15 —
разом **1206/1260**. Без фото лишилися: термостати Flex TDF1/TDU1/TDS1; аксесуари Arnold Rak (муфти, кріплення,
стрічка, трос) і килимок Ribex; термостати SMART (крім RTC-70 SL і PWT002), Castle і EcoTerm (сайтів немає або
заблоковані); саморегулюючі кабелі та муфти Profi Therm (на profitherm.ua їх немає) і кріплення для труб/жолобів;
Heat Plus M79.716B і рушникосушарка XN-WH 606; датчики Eberle та термоголовка ME323 (лише фото in-therm.ua з водяним знаком).
Для них лишається адмінка (завантаження фото вручну).

Якщо фото прив'язалось не до того товару: знайти хеш у `index.json` (або відкрити файл у `data/catalog-media/`), додати
правило в `IMAGE_RULES` чи хеш у `BLACKLIST`, перезапустити extract + parse і переглянути diff `images` у `data/catalog/`.

## Що зроблено (етап 1) і план далі

**Етап 1 (цей PR):** прайси в репозиторії; парсер 8 прайсів → ~1260 файлів товарів; таксономія розділів/міток/брендів;
міграція `archived` + мітки + ціна комплекту; імпортер у `db:predeploy`; старі товари та категорії — в архів;
публічний каталог показує лише `published && !archived`; сторінки міток і фільтр мітками в розділі;
адмінка: прапорець «архівний», ціна комплекту, одиниця та примітка до ціни.

**Етап 2 — фото (зроблено, див. «Фото з прайсів» нижче).** Фото, вшиті в xlsx, витягнуто в `data/catalog-media/` і
прив'язано до товарів; для брендів без фото в прайсі фото завантажено з офіційних сайтів за правилами
`external-sources.json`; імпорт пише їх у `product_images`, entrypoint кладе файли на volume. Разом 1206/1260 товарів з фото.

**Етап 3 — мітки в адмінці.** Редагування міток на картці товару та сторінка міток (створення, групи).
Зараз мітки задає лише парсер.

**Етап 4 — підбір і сортування.** Фільтри за числовими характеристиками (площа, потужність), сортування за ціною,
калькулятор «площа → секція» на базі `area_m2` / `area_at_*`, порівняння брендів у одному розділі.

**Етап 5 — актуалізація.** Прайси приходять з різною датою; показувати «ціна станом на <дата прайсу>»
(`source.date` вже є у файлах) і попереджати про застарілі (> 6 місяців).

Обмеження поточного парсера: розмітка таблиць термостатів In-Therm (рядки-характеристики × стовпці-моделі)
закодована номерами рядків з перевірками (`assert`) — при зміні файлу скрипт зупиниться з підказкою;
PDF Magnum розбирається за координатами слів, два рядки з «розсипаними» літерами переписані вручну.
