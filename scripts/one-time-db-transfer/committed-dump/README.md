# Дамп для одноразового коміту → імпорт на Railway

## Як згенерувати

З кореня репозиторію (локально, є `.env` з `DATABASE_URL`):

```bash
npm run db:ot:dump-for-commit
```

З’явиться **`electroheat.dump`** (custom format). Його **один раз** додають у git і пушать.

## Ризики

- У дампі можуть бути **реальні дані** — публічний репо = витік.
- GitHub: файл **> 100 MiB** не прийме без [Git LFS](https://git-lfs.com/).

## На Railway (один деплой)

1. Variables → **`IMPORT_COMMITTED_DUMP=yes`**
2. Variables → **`RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client`** (щоб був `pg_restore` у контейнері)
3. Деплой. У логах pre-deploy має з’явитися `[import-committed-dump]`.

## Після успіху (прибирання)

1. Видали **`IMPORT_COMMITTED_DUMP`** (і за бажанням `RAILPACK_DEPLOY_APT_PACKAGES`, якщо більше не потрібен).
2. Видали з репо цю папку з дампом, `import-committed-dump.sh`, поверни в `package.json` **`db:predeploy`** до `prisma migrate deploy && prisma db seed` без виклику імпорту.
3. Закоміть.
