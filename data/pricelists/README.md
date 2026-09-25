# Прайси постачальників (сирі файли)

Оригінальні прайси, як їх надіслали постачальники. Імена нормалізовано (дата-постачальник), вміст не змінено.
Розбирає їх `scripts/pricelists/parse_pricelists.py` → `data/catalog/<постачальник>/*.json`
(див. `docs/CATALOG-PRICELISTS-UK.md`).

| Файл | Оригінальна назва | Постачальник / бренди | Дата прайсу | Ключ у `data/catalog` |
|------|-------------------|-----------------------|-------------|------------------------|
| `2026-05-heat-plus.xlsx` | `05_2026_Heat_Plus_.xlsx` | Heat Plus: терморегулятори, рушникосушарки | 05.2026 | `heat-plus` |
| `2026-06-08-arnold-rak-ryxon-flex.xlsx` | `08_06_26_прайс_общ.xlsx` | Arnold Rak (Premium / Standart), Ryxon, Flex, кріплення | 08.06.2026 | `ar-ryxon-flex` |
| `2026-08-13-in-therm.xlsx` | `IN-THERM_PRICE_13_08_2026.xlsx` | ТОВ «ІН-ТЕРМ»: Hemstedt, Fenix, IN-THERM, Eberle, Eltrace, плівка, ІЧ-панелі, ЗВП, Deye, Bluetti… | 13.08.2026 | `in-therm` |
| `2026-smart-thermostats.xlsx` | `SMART_price_2026_.xlsx` | SMART: терморегулятори | 2026 | `smart` |
| `2026-09-15-rd-nexans-profitherm.xlsx` | `Прайс РД 15.09.2026.xlsx` | «РД»: Nexans, Wärme, Profi Therm, OJ Electronics, Zuver, Акваблок | 15.09.2026 | `rd` |
| `2026-04-01-easytherm-extherm-hotfly.xlsx` | `Прайс_01.04.2026_EasyTherm, ExTherm.xlsx` | Easytherm, Extherm, Hot Fly | 01.04.2026 | `easytherm-extherm` |
| `2025-09-10-shtoller.docx` | `Прайс_Shtoller10_09_25_….docx` | Shtoller (Ecotherm) | 10.09.2025 | `shtoller` |
| `2026-magnum-tp.pdf` | `ПРАЙС_2026_ТП NEW.pdf` | Magnum (C&F Technics), HTS eHeat, MHW, Terneo, EcoTerm, Castle; курс € = 53 | 2026 | `magnum-tp` |

Що **не** потрапляє в каталог (немає цін або це не товар): відрізні кабелі Hemstedt з розрахунком муфтування,
Nexans TXLP на барабанах, кабелі живлення ПВС, інвертори/АКБ без ціни лишаються з «ціну уточнюйте»,
килимки Extherm («Не поставляется»), ІЧ-панелі Bilux (лише посилання на сайт).
