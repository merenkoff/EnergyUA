# Каталог з прайсів — один файл = один товар

Папка = ключ прайсу (`heat-plus`, `in-therm`, `rd`, …), файл = `<sku-slug>.json`.
Формат описано в `scripts/lib/pricelistProduct.ts`; slug-и розділів/міток/брендів — у `scripts/lib/pricelistTaxonomy.ts`.

Файли **генеруються** скриптом `npm run parse:pricelists` з `data/pricelists/` — не редагуйте їх вручну:
наступний запуск парсера перезапише папку. Ручні правки робляться в адмінці після імпорту або в самому парсері.

Імпорт у БД: `npm run import:pricelists` (виконується на кожному деплої в `db:predeploy`).
