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

1. **Найшвидше, якщо локально вже є той самий `storage/media`** (ті самі `sha256.ext`, що в БД): з Mac виконай передачу на volume через SSH-потік:
   ```bash
   npm run db:push-media-railway
   ```
   (за замовчуванням сервіс `EnergyUA`; інший: `npm run db:push-media-railway -- ІмяСервісу`. Каталог на сервері: `RAILWAY_REMOTE_MEDIA_ROOT=/data/media`.) Потім знову `bash /app/scripts/railway-media-diagnose.sh`. Спочатку gzip-потік пишеться у **тимчасовий файл** у контейнері (`/tmp/eh-media-staging.tgz` або `PUSH_MEDIA_STAGING`), потім `tar xzf` на volume — так уникаємо «зависання» з ~64 KiB і 0 B/s у `pv` через backpressure одночасної розпаковки. Показує кількість файлів і розмір; під час передачі — `pv` (`brew install pv`) або heartbeat + `tar -v`. `PUSH_MEDIA_QUIET=1` — без цього.
2. **Після міграції з колонкою `source_url`**: якщо в рядках заповнено `source_url`, а файлу немає — докачка з інтернету:
   ```bash
   railway ssh -s EnergyUA -- bash -lc 'cd /app && npx tsx scripts/cli/repair-missing-product-images.ts'
   ```
   або локально з публічним `DATABASE_URL` і правильним `MEDIA_ROOT`: `npm run db:repair-images`. Для **старих** рядків без `source_url` repair нічого не зробить — лише п.1 або реімпорт.
3. **Відкотити БД** до зовнішніх `http(s)` у `product_images` + знову mirror на контейнері з volume (якщо є бекап БД).

З **нових** деплоїв mirror записує **`source_url`** (оригінальний URL) при заміні на `/api/media/…`, щоб можна було **repair** без копії файлів.

## Локально

```bash
npm run db:mirror-images
```

Файли в `storage/media/` (у `.gitignore`).

## Діагностика (скопіюй вивід у чат)

Усі рядки мають префікс **`[media-diagnose]`** — зручно фільтрувати й надсилати асистенту цілком.

### Важливо: `railway run` ≠ контейнер на Railway

Команда **`railway run npm run …`** виконується **на твоєму комп’ютері** (Mac/PC), лише **підставляючи змінні** з проєкту Railway. Тому типово:

- **`DATABASE_URL` з хостом `*.railway.internal`** — **не підключається** з дому (цей хост лише всередині мережі Railway).
- **`MEDIA_ROOT=/data/media`** — на Mac **немає** змонтованого volume → `ENOENT` для `/data` — **очікувано**, не баг застосунку.

### Повна діагностика (БД + файли на volume)

Потрібен доступ до **того самого** середовища, що й у проді: **SSH у контейнер сервісу застосунку** (де змонтований volume і працює internal DB).

**Не використовуй** `railway ssh … -- npm run …` без `cd` у корінь застосунку: SSH часто стартує в `/root`, тоді npm не бачить твій `package.json` або бачить інший → `Missing script`.

Надійно — оболонка з **`scripts/railway-media-diagnose.sh`** (той самий прийом, що в `railway-entrypoint.sh`: перехід у корінь репо за шляхом скрипта):

```bash
railway ssh -s EnergyUA -- bash /app/scripts/railway-media-diagnose.sh
```

(заміни `EnergyUA` на ім’я свого **сервісу з Next**, не Postgres.)

Якщо **`No such file`** для `/app` — зайди в інтерактивний `railway ssh -s EnergyUA`, знайди `package.json` (`ls /app`, `pwd`) і запусти звідти:

```bash
bash scripts/railway-media-diagnose.sh
```

Або явний `cd`:

```bash
railway ssh -s EnergyUA -- sh -lc 'cd /app && npm run db:media-diagnose'
```

Якщо **`Missing script: db:media-diagnose`** навіть після `cd /app` — на Railway задеплоєна **стара** версія репозиторію: зроби deploy з гілки, де в `package.json` уже є `db:media-diagnose` (і є `scripts/cli/media-storage-diagnose.ts`).

### Лише перевірка БД з домашнього Mac

1. У **Railway** → сервіс **PostgreSQL** → вкладка **Variables** або **Connect** — скопіюй рядок з **публічним** хостом (на кшталт `postgres-production-xxxx.up.railway.app`), з **SSL** якщо платформа просить (`sslmode=require` у query).
2. Тимчасово підстав його й **локальний** каталог для файлів (або свій клон `storage/media`), наприклад:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@postgres-production-5919.up.railway.app:PORT/railway?sslmode=require'
export MEDIA_ROOT="$(pwd)/storage/media"
unset RAILWAY_ENVIRONMENT
npm run db:media-diagnose
```

`unset RAILWAY_ENVIRONMENT` прибирає «хмарні» підказки в логах, якщо вони лишилися в shell.

### Локально проти своєї БД

```bash
npm run db:media-diagnose
```

Скрипт перевіряє: `MEDIA_ROOT`, запис у каталог, `df`, кількість файлів `sha256.ext` на диску, у Prisma — скільки рядків з `http(s)` і з `/api/media/`, і для локальних URL — чи існує файл.

## Скрипти

- **`scripts/push-media-to-railway-volume.sh`** — стиснення локального `storage/media` і розпаковка в `$MEDIA_ROOT` на сервісі через `railway ssh` (`npm run db:push-media-railway`).
- **`scripts/railway-media-diagnose.sh`** — діагностика **в контейнері** Railway без залежності від cwd SSH (`bash /app/scripts/railway-media-diagnose.sh`).
- **`scripts/cli/media-storage-diagnose.ts`** — діагностика volume + БД (`npm run db:media-diagnose`).
- **`scripts/cli/repair-missing-product-images.ts`** — докачка відсутніх файлів за `source_url` (`npm run db:repair-images`).
- **`scripts/cli/mirror-product-images.ts`** — завантаження, дедуп за SHA-256 URL, оновлення `product_images.url` + заповнення `source_url`.
- **`scripts/railway-entrypoint.sh`** — опційний mirror за `MIRROR_PRODUCT_IMAGES=yes`, далі `next start`.

**Pre-deploy** (`db:predeploy`) лише: `prisma migrate deploy` + `prisma db seed` — **без** mirror.

## Перевірка

```bash
curl -sI "https://<host>/api/media/<64hex>.jpg" | head -1
```

Очікуй **`200`** і `Content-Type: image/...`.
