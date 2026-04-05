# Деплой на Railway

У корені репозиторію лежить [`railway.json`](../railway.json): збірка через Railpack, перед стартом виконується `prisma migrate deploy`, потім `npm run start`.

## Що зробити в Railway (один раз)

1. **Створити проект** і додати **PostgreSQL** (або використати вже створену базу).
2. **Додати сервіс** з репозиторію GitHub (або підключити існуючий репо в Settings → Source).
3. У сервісі застосунку: **Variables** → додати **`DATABASE_URL`**. Найпростіше: **Reference** на змінну з Postgres-сервісу (`${{Postgres.DATABASE_URL}}` або аналог у UI).
4. Переконатися, що деплой іде з потрібної гілки (наприклад `main`).
5. Після push Railway сам збере образ, виконає **Pre-deploy** (міграції) і **Deploy** (start).

## Змінні оточення

| Змінна | Опис |
|--------|------|
| `DATABASE_URL` | Обов’язково для runtime і для **pre-deploy** (міграції). |

Інші змінні (наприклад для імпорту каталогу) додавай у Variables того ж сервісу, якщо потрібні в рантаймі.

## Логи

У Railway: сервіс → **Deployments** → відкрити деплой → **Build Logs** / **Deploy Logs**. Помилки міграцій шукай у кроці **Pre-deploy**.

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`): lint + build на push/PR у `main`/`master`.
- **Deploy Railway** (`.github/workflows/deploy-railway.yml`): за замовчуванням **вимкнено** (`if: false`). Увімкни лише якщо хочеш деплой через CLI з секретом `RAILWAY_TOKEN`; інакше достатньо вбудованого деплою з Git у Railway.

## Локально

```bash
npm run db:migrate:deploy   # застосувати міграції до продакшен-БД (потрібен DATABASE_URL)
```
