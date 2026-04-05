# Одноразовий перенос БД: локально → Railway (або інший Postgres)

Два **коміти** у репозиторії:

1. **Етап A (коміт 1):** зʼявляється ця папка + рядки в `.gitignore`. Ти виконуєш команди **локально** (дамп і restore). У git **не** потрапляє вміст БД — лише скрипти.
2. **Етап B (коміт 2):** видаляєш усю папку `scripts/one-time-db-transfer/` і прибираєш з `.gitignore` блок «One-time DB transfer» (якщо більше ніде не потрібен). Це не Prisma-міграції — лише тимчасові скрипти.

## Вимоги

- Встановлені клієнти PostgreSQL: `pg_dump`, `pg_restore` (macOS: `brew install libpq`, інколи `brew link --force libpq`).
- Локально: робоча БД у `.env` як `DATABASE_URL` **або** змінна `SOURCE_DATABASE_URL`.
- Віддалено: повний URL Railway Postgres, зазвичай з **`?sslmode=require`** (скопіюй з Railway → Postgres → Connect / Variables).

**Важливо:** з Cursor/CI **неможливо** зробити дамп твоєї локальної БД — потрібен запуск **на твоїй машині**, де крутиться Postgres і є `.env`.

## Дамп у git → один деплой на Railway

Якщо хочеш **закомітити** дамп і один раз імпортувати на сервері: [`committed-dump/README.md`](committed-dump/README.md), команда **`npm run db:ot:dump-for-commit`**, змінні **`IMPORT_COMMITTED_DUMP=yes`** та **`RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client`**. Після імпорту прибери змінні й видали дамп з репо.

## Автоматично (одна команда)

Джерело: `DATABASE_URL` з `.env` (або `SOURCE_DATABASE_URL`). Ціль: змінна оточення.

```bash
REALLY_REPLACE_REMOTE=yes \
TARGET_DATABASE_URL='postgresql://USER:PASS@HOST:PORT/railway?sslmode=require' \
npm run db:ot:transfer
```

Після успіху файл `out/electroheat.dump` лишається (можна повторити restore). Щоб видалити дамп одразу після успішного restore:

```bash
REMOVE_DUMP_AFTER_OK=yes REALLY_REPLACE_REMOTE=yes TARGET_DATABASE_URL='...' npm run db:ot:transfer
```

Лог у тому ж **`out/last-transfer.log`**.

## Кроки (одноразово, вручну двома кроками)

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

Після кожного запуску `db:ot:transfer` / `db:ot:dump` / `db:ot:restore` оновлюється **`scripts/one-time-db-transfer/out/last-transfer.log`** (також у `.gitignore`). Там — кроки, версії `pg_dump`/`pg_restore`, повний вивід утиліт і **URL з прихованим паролем**. Якщо щось зламалось — надішли цей файл (або його вміст) в чат. На **етапі B** разом із папкою `one-time-db-transfer` це прибирається з проєкту.

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

Видали з `package.json` скрипти `db:ot:transfer`, `db:ot:dump-for-commit`, `db:ot:dump` та `db:ot:restore`, поверни **`db:predeploy`** до `prisma migrate deploy && prisma db seed` без `import-committed-dump.sh`, з `.gitignore` — секцію `One-time DB transfer`. Закоміть — другий етап завершено.

## Якщо `pg_restore` падає (extensions / права)

Інколи на Railway конфліктують розширення чи схема. Варіанти:

- Створити **нову** порожню базу в тому ж інстансі й підставити її URL у `TARGET_DATABASE_URL`.
- Або через `psql` до **порожньої** цільової БД виконати скидання схеми `public` (обережно, лише якщо розумієш наслідки), потім знову `restore-to-remote.sh`.

## Парсинг у майбутньому

Після переносу даних парсинг/імпорт можна ганяти з машини з `DATABASE_URL` на прод або через окремий job — логіка проєкту не змінюється, змінюється лише куди вказує зʼєднання.
