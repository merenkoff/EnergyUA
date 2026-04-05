# Деплой на Railway

У корені репозиторію лежить [`railway.json`](../railway.json): збірка через Railpack, перед стартом виконується **`npm run db:predeploy`**: спочатку (якщо увімкнено) **одноразовий імпорт дампу з репо**, далі `prisma migrate deploy` і **`prisma db seed`**, потім `npm run start`. Деталі одноразового дампу — [`scripts/one-time-db-transfer/committed-dump/README.md`](../scripts/one-time-db-transfer/committed-dump/README.md).

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
| `IMPORT_COMMITTED_DUMP` | Лише для **одного** деплою: значення `yes` — виконати `pg_restore` з файлу в репо (`committed-dump/electroheat.dump`). Після успіху **обов’язково прибрати**, інакше кожен деплой знову перезапише БД. |
| `RAILPACK_DEPLOY_APT_PACKAGES` | Зазвичай **не потрібно**: у репо є [`railpack.json`](../railpack.json) з `postgresql-client` у фінальному образі (для `pg_restore` при `IMPORT_COMMITTED_DUMP=yes`). Якщо збірка ігнорує файл — задай змінну вручну ([Railpack: Apt](https://railpack.com/guides/installing-packages)). |

Інші змінні (наприклад для імпорту каталогу) додавай у Variables того ж сервісу, якщо потрібні в рантаймі.

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
