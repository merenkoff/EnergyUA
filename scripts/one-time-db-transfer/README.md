# Одноразовий перенос БД: локально → Railway (або інший Postgres)

Два **коміти** у репозиторії:

1. **Етап A (коміт 1):** зʼявляється ця папка + рядки в `.gitignore`. Ти виконуєш команди **локально** (дамп і restore). У git **не** потрапляє вміст БД — лише скрипти.
2. **Етап B (коміт 2):** видаляєш усю папку `scripts/one-time-db-transfer/` і прибираєш з `.gitignore` блок «One-time DB transfer» (якщо більше ніде не потрібен). Це не Prisma-міграції — лише тимчасові скрипти.

## Вимоги

- Встановлені клієнти PostgreSQL: `pg_dump`, `pg_restore` (macOS: `brew install libpq`, інколи `brew link --force libpq`).
- Локально: робоча БД у `.env` як `DATABASE_URL` **або** змінна `SOURCE_DATABASE_URL`.
- Віддалено: повний URL Railway Postgres, зазвичай з **`?sslmode=require`** (скопіюй з Railway → Postgres → Connect / Variables).

## Кроки (одноразово)

### 1) Дамп локальної БД

З кореня репозиторію:

```bash
npm run db:ot:dump
# або
bash scripts/one-time-db-transfer/dump-from-local.sh
```

Або явно:

```bash
SOURCE_DATABASE_URL='postgresql://...' bash scripts/one-time-db-transfer/dump-from-local.sh
```

Файл зʼявиться в `scripts/one-time-db-transfer/out/electroheat.dump` (у `.gitignore`).

### Логи (діагностика)

Після кожного запуску `db:ot:dump` / `db:ot:restore` оновлюється **`scripts/one-time-db-transfer/out/last-transfer.log`** (також у `.gitignore`). Там — кроки, версії `pg_dump`/`pg_restore`, повний вивід утиліт і **URL з прихованим паролем**. Якщо щось зламалось — надішли цей файл (або його вміст) в чат. На **етапі B** разом із папкою `one-time-db-transfer` це прибирається з проєкту.

### 2) Відновлення на сервері (заміна вмісту)

**Увага:** на цільовій БД існуючі обʼєкти з тими ж іменами будуть видалені й створені знову (`--clean --if-exists`). Роби бекап продакшену, якщо там уже щось важливе.

```bash
REALLY_REPLACE_REMOTE=yes \
TARGET_DATABASE_URL='postgresql://USER:PASS@HOST:PORT/railway?sslmode=require' \
bash scripts/one-time-db-transfer/restore-to-remote.sh
```

### 3) Перевірка

- Відкрий прод-сайт / каталог.
- За потреби: `npx prisma migrate status` з `DATABASE_URL` на прод (має відповідати стану після дампу).

### 4) Прибрати з репо (етап B)

```bash
rm -rf scripts/one-time-db-transfer
```

Видали з `package.json` скрипти `db:ot:dump` та `db:ot:restore`, з `.gitignore` — секцію `One-time DB transfer`. Закоміть — другий етап завершено.

## Якщо `pg_restore` падає (extensions / права)

Інколи на Railway конфліктують розширення чи схема. Варіанти:

- Створити **нову** порожню базу в тому ж інстансі й підставити її URL у `TARGET_DATABASE_URL`.
- Або через `psql` до **порожньої** цільової БД виконати скидання схеми `public` (обережно, лише якщо розумієш наслідки), потім знову `restore-to-remote.sh`.

## Парсинг у майбутньому

Після переносу даних парсинг/імпорт можна ганяти з машини з `DATABASE_URL` на прод або через окремий job — логіка проєкту не змінюється, змінюється лише куди вказує зʼєднання.
