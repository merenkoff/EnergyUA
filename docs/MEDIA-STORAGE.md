# Зображення товарів: локальне сховище на Railway

Зовнішні URL у таблиці `product_images` можна **одноразово** (або повторно, ідемпотентно) перенести у файли на диску. Сайт віддає їх через **`/api/media/{sha256}.{ext}`** (Next.js route).

## Чому без окремого S3

На **Railway** достатньо **[Volume](https://docs.railway.com/reference/volumes)** на сервісі застосунку: диск монтується в контейнер (наприклад `/data/media`), дані переживають редеплої. Окремий платний object-storage не обов’язковий для старту.

Обмеження: один інстанс або спільний volume; для великого горизонтального масштабу пізніше можна винести файли в R2/S3 без зміни схеми БД (лише змінити базовий URL у `url`).

## Змінні оточення

| Змінна | Опис |
|--------|------|
| `MEDIA_ROOT` | Каталог файлів. **Локально:** за замовчуванням `storage/media` у корені репо. **Railway:** шлях монтування volume, наприклад `/data/media`. |
| `MIRROR_PRODUCT_IMAGES` | Якщо `yes`, під час **`npm run db:predeploy`** після міграцій запускається дзеркалення зовнішніх URL, потім seed. **Постав один раз**, після успішного деплою **прибери**, щоб не ганяти завантаження на кожен deploy. |
| `MIRROR_IMAGE_MAX_BYTES` | Макс. розмір одного файлу (байти), за замовчуванням `15728640` (15 MiB). |
| `MIRROR_IMAGE_CONCURRENCY` | Паралельні завантаження (1–16), за замовчуванням `6`. |

## Railway: налаштування Volume

1. Сервіс застосунку (Next) → **Volumes** → **Add volume**.
2. Mount path, наприклад: **`/data/media`**.
3. **Variables** → `MEDIA_ROOT=/data/media`.
4. Одноразово: **`MIRROR_PRODUCT_IMAGES=yes`**, redeploy.
5. Після успіху: **видали** `MIRROR_PRODUCT_IMAGES` (залиш `MEDIA_ROOT`).

## Локально

```bash
# переконайся, що DATABASE_URL у .env
npm run db:mirror-images
```

Файли з’являться в `storage/media/` (у `.gitignore`).

## Скрипт

- **`scripts/cli/mirror-product-images.ts`** — завантаження, дедуплікація за SHA-256 URL, оновлення `product_images.url` на `/api/media/...`.
- **`scripts/mirror-product-images-if-enabled.sh`** — викликається з `db:predeploy` лише за `MIRROR_PRODUCT_IMAGES=yes`.

## Автоматично «після коміту»

Push у `main` → Railway будує образ → **pre-deploy** виконує `db:predeploy`. Якщо в Variables увімкнено **`MIRROR_PRODUCT_IMAGES=yes`**, у цьому ж деплої відпрацює дзеркалення. Це і є «автоматично після коміту» без окремого GitHub Action (не потрібно дублювати `DATABASE_URL` у GitHub).
