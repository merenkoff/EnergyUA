# Зображення товарів: локальне сховище на Railway

Зовнішні URL у таблиці `product_images` можна **ідемпотентно** перенести у файли на диску. Сайт віддає їх через **`/api/media/{sha256}.{ext}`** (Next.js route).

## Чому без окремого S3

На **Railway** достатньо **[Volume](https://docs.railway.com/reference/volumes)** на сервісі застосунку: диск монтується в контейнер (наприклад `/data/media`), дані переживають редеплої. Окремий object-storage не обов’язковий для старту.

Обмеження: один інстанс або спільний volume; для великого горизонтального масштабу пізніше можна винести файли в R2/S3.

## Важливо: Volume і `MEDIA_ROOT` мають збігатися

- У **Variables** задай **`MEDIA_ROOT`** **точно** на шлях монтування volume (наприклад volume mount **`/data/media`** → **`MEDIA_ROOT=/data/media`**).
- Якщо **`MEDIA_ROOT` не задано**, файли йдуть у **`/app/storage/media`** усередині образу — це **не** volume, після редеплою файли **зникнуть**, а в БД лишаться шляхи `/api/media/...` → у браузері **зламані картинки (404)**.

## Чому mirror не в pre-deploy

**Pre-deploy** на Railway часто виконується в середовищі, де **ще немає** змонтованого volume (або запис іде в ephemeral шар). Тому дзеркалення запускається в **`scripts/railway-entrypoint.sh`** **перед** `next start`, коли volume уже доступний. У [`railway.json`](../railway.json) задано `startCommand: bash scripts/railway-entrypoint.sh`.

## Змінні оточення

| Змінна | Опис |
|--------|------|
| `MEDIA_ROOT` | Каталог файлів. Локально: `storage/media`. Railway: **той самий шлях, що й mount volume**. |
| `MIRROR_PRODUCT_IMAGES` | Якщо `yes`, при **старті** контейнера (перед `next start`) виконується `mirror-product-images.ts`. Після першого успішного деплою з файлами на volume краще **прибрати** змінну (повторний запуск швидкий, якщо всі URL уже `/api/media/…`, але зайвий прохід по БД не потрібен). |
| `MIRROR_IMAGE_MAX_BYTES` | Макс. розмір одного файлу (байти), за замовчуванням `15728640` (15 MiB). |
| `MIRROR_IMAGE_CONCURRENCY` | Паралельні завантаження (1–16), за замовчуванням `6`. |

## Railway: кроки

1. Сервіс застосунку → **Volumes** → mount **`/data/media`** (або інший шлях — тоді підстав його всюди).
2. **Variables:** `MEDIA_ROOT=/data/media` (той самий шлях).
3. Для першого наповнення: **`MIRROR_PRODUCT_IMAGES=yes`**, deploy.
4. Перевір у браузері прямий URL: `https://<твій-домен>/api/media/<перший-файл>.jpg` (ім’я візьми з БД або з логів mirror).
5. Після успіху: **видали** `MIRROR_PRODUCT_IMAGES`, **`MEDIA_ROOT` залиш**.

## Якщо в HTML є `/api/media/...`, але 404

Це означає: **у БД вже локальні шляхи**, а **файлів на volume немає** (типово після mirror у pre-deploy без volume або з невірним `MEDIA_ROOT`).

**Варіанти відновлення:**

1. **Скопіювати файли** з машини, де mirror уже відпрацював у правильний `storage/media` (наприклад локально): заархівуй `storage/media`, розпакуй у volume на Railway (`railway run`, `tar`, тощо) у каталог **`$MEDIA_ROOT`**.
2. **Відкотити БД** до стану з **зовнішніми** `http(s)` URL у `product_images`, виправити `MEDIA_ROOT` + volume, знову увімкнути **`MIRROR_PRODUCT_IMAGES=yes`** і задеплоїти з новим entrypoint.

Скрипт mirror **не зберігає** оригінальний URL після заміни — без бекапу БД або копії файлів відновити лише з реімпорту каталогу.

## Локально

```bash
npm run db:mirror-images
```

Файли в `storage/media/` (у `.gitignore`).

## Скрипти

- **`scripts/cli/mirror-product-images.ts`** — завантаження, дедуп за SHA-256 URL, оновлення `product_images.url`.
- **`scripts/railway-entrypoint.sh`** — опційний mirror за `MIRROR_PRODUCT_IMAGES=yes`, далі `next start`.

**Pre-deploy** (`db:predeploy`) лише: `prisma migrate deploy` + `prisma db seed` — **без** mirror.

## Перевірка

```bash
curl -sI "https://<host>/api/media/<64hex>.jpg" | head -1
```

Очікуй **`200`** і `Content-Type: image/...`.
