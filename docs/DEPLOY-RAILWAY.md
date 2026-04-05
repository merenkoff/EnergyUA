# Деплой на Railway

У корені репозиторію лежить [`railway.json`](../railway.json): збірка через Railpack, **pre-deploy** — одна команда **`npm run db:predeploy:railway`** (міграції + seed + опційно реімпорт, якщо **`RAILWAY_REBUILD_CATALOG=yes`**). **start** — [`scripts/railway-entrypoint.sh`](../scripts/railway-entrypoint.sh) (опційно mirror фото за `MIRROR_PRODUCT_IMAGES=yes`, далі `next start`). Деталі фото — [`MEDIA-STORAGE.md`](MEDIA-STORAGE.md).

## Що зробити в Railway (один раз)

1. **Створити проект** і додати **PostgreSQL** (або використати вже створену базу).
2. **Додати сервіс** з репозиторію GitHub (або підключити існуючий репо в Settings → Source).
3. У сервісі застосунку: **Variables** → додати **`DATABASE_URL`**. Найпростіше: **Reference** на змінну з Postgres-сервісу (`${{Postgres.DATABASE_URL}}` або аналог у UI).
4. Переконатися, що деплой іде з потрібної гілки (наприклад `main`).
5. Після push Railway сам збере образ, виконає **Pre-deploy** (міграції + seed) і **Deploy** (start).

Якщо сайт уже був задеплоєний **до** появи seed у pre-deploy: зроби **Redeploy** (або порожній commit), щоб прогнався новий крок. Або один раз у консолі: `railway run npm run db:seed` (з `DATABASE_URL`).

## Змінні оточення

| Змінна | Опис |
|--------|------|
| `DATABASE_URL` | Обов’язково для runtime і для **pre-deploy** (міграції). |
| `RAILWAY_REBUILD_CATALOG` | Якщо **`yes`**, після seed у pre-deploy виконується скидання імпортованих товарів/категорій і повторний імпорт з **`data/scrape/*.json`** у образі (без парсингу сайтів). Після успішного деплою **прибери** змінну, щоб кожен deploy не перезатирав каталог. |
| `RAILWAY_CATALOG_WIPE_ALL` | Разом з ребілдом: **`yes`** — видалити **всі** товари (включно з демо seed), потім `prisma db seed`, потім імпорт JSON. |
| `MEDIA_ROOT` | Каталог volume для фото; див. [`MEDIA-STORAGE.md`](MEDIA-STORAGE.md). |
| `MIRROR_PRODUCT_IMAGES` | **`yes`** у start: завантажити зовнішні URL у `MEDIA_ROOT` і замінити на `/api/media/…`. Потрібно після реімпорту, поки в БД знову `https://…` для картинок. |

### Рімпорт каталогу на проді + локальні картинки на volume

1. Закоміть актуальні маніфести в **`data/scrape/`** (оновлення з донорів — локально, див. [`IMPORT-UK.md`](IMPORT-UK.md): `parse:*`, `run-full-detail-import.sh`).
2. У Variables тимчасово: **`RAILWAY_REBUILD_CATALOG=yes`**, **`MIRROR_PRODUCT_IMAGES=yes`**, коректні **`MEDIA_ROOT`** і volume.
3. Deploy. У pre-deploy підуть міграції, seed, потім реімпорт з JSON; при старті контейнера mirror стягне фото на диск.
4. Після перевірки сайту: **вимкни** `RAILWAY_REBUILD_CATALOG` (і за бажанням `MIRROR_PRODUCT_IMAGES`).

Локально той самий реімпорт без зміни Railway: **`npm run db:rebuild-catalog`** (потрібен `DATABASE_URL`).

Інші змінні додавай у Variables того ж сервісу, якщо потрібні в рантаймі.

## Логи

У Railway: сервіс → **Deployments** → відкрити деплой → **Build Logs** / **Deploy Logs**. Помилки міграцій шукай у кроці **Pre-deploy**.

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`): lint + build на push/PR у `main`/`master`.
- **Deploy Railway** (`.github/workflows/deploy-railway.yml`): за замовчуванням **вимкнено** (`if: false`). Увімкни лише якщо хочеш деплой через CLI з секретом `RAILWAY_TOKEN`; інакше достатньо вбудованого деплою з Git у Railway.

## Локально

```bash
npm run db:migrate:deploy   # лише міграції
npm run db:predeploy        # міграції + seed (як на Railway pre-deploy)
npm run db:seed             # лише seed (ідемпотентний upsert)
```

Повне копіювання локальної БД на прод **без коміту дампу в репозиторій**: [`scripts/one-time-db-transfer/README.md`](../scripts/one-time-db-transfer/README.md) (`npm run db:ot:transfer` та варіанти з `pg_dump`/`pg_restore`).

Зображення товарів (Volume, одноразове дзеркалення URL): [`MEDIA-STORAGE.md`](MEDIA-STORAGE.md).
