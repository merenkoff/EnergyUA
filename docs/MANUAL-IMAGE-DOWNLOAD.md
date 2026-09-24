# Ручне завантаження фото з донора за Cloudflare (in-heat)

**in-heat.kiev.ua** закритий перевіркою Cloudflare (сторінка «Just a moment…»). Сервер на Railway і `mirror-product-images.ts` отримують цю сторінку замість фото, тому фото in-heat не потрапляють на volume. Їх качає людина у **своєму браузері**, після того як сама пройшла перевірку. Відповідальність за завантаження (права на фото, навантаження на сайт донора) лежить на тому, хто це запускає. Сніпет навмисно повільний: 2 паралельні запити й пауза 300 мс.

## Як це працює

1. **`prepare`** бере список URL фото in-heat, звіряє його з `storage/media` і генерує сніпет для браузера лише для відсутніх фото.
2. **Сніпет** вставляєш у консоль DevTools на in-heat.kiev.ua. Він качає фото тією ж сесією браузера й зберігає ZIP з файлами `{sha256(URL)}.{ext}`. Так файли називає й mirror.
3. **`ingest`** перевіряє ZIP (приймає лише справжні зображення з правильними іменами), кладе файли в `storage/media` і збирає в `push/` усі фото in-heat для Railway.
4. **`db:push-media-railway`** з `PUSH_MEDIA_DIR` відправляє на volume лише ці файли.
5. **mirror на Railway** знаходить файли за іменем і переключає `product_images.url` на `/api/media/…`, нічого не качаючи.

Потрібно: локальний клон цієї гілки з `npm ci`, Chrome (або Edge, Brave, Arc; у Firefox і Safari теж працює, лише DevTools відкриваються інакше), Railway CLI з `railway login` і `railway link` для кроків 4–5.

## Крок 1. Підготувати список

```bash
npm ci
npm run db:manual-images:prepare
```

Скрипт покаже, скільки фото потрібно, скільки вже є локально (наприклад, серед тих ~3.5 тис. у `storage/media`) і скільки бракує. Робочі файли лежать у `storage/manual-download/in-heat.kiev.ua/` (у `.gitignore`):

| Файл | Що це |
|------|-------|
| `urls.json` | повний список URL і цільових імен файлів |
| `downloader.js` | сніпет для браузера (лише відсутні фото) |
| `push/` | усі наявні фото in-heat для відправки на Railway (жорсткі посилання на файли з `storage/media`) |

**Звідки список.** За замовчуванням береться `data/scrape/in-heat-catalog-DETAIL.json`, той самий файл, який імпортує прод. Щоб узяти рівно те, що зараз у прод-БД, використай `--from-db` з публічним `DATABASE_URL` (як його знайти, див. [MEDIA-STORAGE.md](MEDIA-STORAGE.md), розділ «Лише перевірка БД з домашнього Mac»):

```bash
DATABASE_URL='postgresql://…@….up.railway.app:PORT/railway?sslmode=require' \
  npm run db:manual-images:prepare -- --from-db
```

З `--from-db` у список потрапляють і рядки, які вже переключені на `/api/media/…`, але файлів яких немає. Такі файли будуть названі так, як у БД.

## Крок 2. Скачати фото в браузері

1. Скопіюй сніпет у буфер:
   ```bash
   pbcopy < storage/manual-download/in-heat.kiev.ua/downloader.js
   ```
   (Linux: `xclip -selection clipboard < …`, або відкрий файл у редакторі й скопіюй увесь вміст.)
2. Відкрий https://in-heat.kiev.ua/ua/ і дочекайся, поки пройде «Just a moment…» і відкриється звичайний сайт.
3. Відкрий консоль DevTools: **Cmd+Option+J** (Mac) або **Ctrl+Shift+J** (Windows/Linux).
4. Встав сніпет (Cmd+V) і натисни Enter. Якщо Chrome попереджає про вставку коду, набери `allow pasting`, натисни Enter і встав ще раз.
5. Праворуч унизу з'явиться панель з прогресом. **Не закривай і не оновлюй вкладку**, доки не з'явиться «Готово». Наприкінці браузер збереже в «Завантаження» файл `in-heat.kiev.ua-images-<дата>-1.zip`. Якщо Chrome спитає про завантаження кількох файлів, дозволь.

Зупинити завчасно можна командою `ehStopDownload()` у консолі; вже скачане все одно збережеться в ZIP. Після 10 помилок поспіль сніпет зупиняється сам (зазвичай це значить, що перевірка Cloudflare протухла або сайт почав обмежувати запити). Тоді імпортуй те, що є (крок 3), онови сторінку (F5), знову пройди перевірку й запусти **новий** `downloader.js`: `ingest` уже перегенерував його лише для решти фото.

## Крок 3. Імпортувати ZIP

```bash
npm run db:manual-images:ingest -- ~/Downloads/in-heat.kiev.ua-images-*.zip
```

Приймаються лише файли `{sha256}.{jpg|png|webp|gif}`, вміст яких справді є зображенням. HTML «Just a moment…» та інше сміття відкидаються, наявні файли не перезаписуються. Замість ZIP можна передати каталог з такими файлами.

Після імпорту скрипт знову звіряє список. Якщо пише «бракує N» і N > 0, повтори крок 2 з оновленим `downloader.js`. Фото, які in-heat віддає з `HTTP 404`, на донорі вже немає: їх можна лишити або замінити в адмінці. ZIP після імпорту можна видалити.

## Крок 4. Відправити на Railway

```bash
PUSH_MEDIA_DIR=storage/manual-download/in-heat.kiev.ua/push npm run db:push-media-railway
```

Так на volume ідуть лише фото in-heat (разом з тими, що були в `storage/media` ще до ручного завантаження), а не всі ~3.5 тис. файлів. Без `PUSH_MEDIA_DIR` відправиться весь `storage/media`: це теж працює, просто довше. Якщо сервіс називається не `EnergyUA`: `npm run db:push-media-railway -- ІмяСервісу`.

## Крок 5. Переключити URL у БД

Якщо рядки in-heat у прод-БД ще із зовнішніми URL (mirror не зміг їх скачати), запусти mirror у контейнері. Він знайде файли на volume за іменем і лише оновить `product_images.url`:

```bash
railway ssh -s EnergyUA -- env MEDIA_ROOT=/data/media /app/node_modules/.bin/tsx /app/scripts/cli/mirror-product-images.ts
```

У підсумку буде «повторне використання файлу: N». Для фото in-heat, яких на volume так і немає, mirror і далі пише `FAIL` (Cloudflare). Це очікувано: такі рядки лишаються зі зовнішнім URL.

Якщо на сервісі `MIRROR_PRODUCT_IMAGES=yes`, замість цієї команди можна просто зробити Restart сервісу: mirror запускається у фоні при старті.

Якщо ці рядки вже мали `/api/media/…` (файли колись загубилися), крок 5 не потрібен: після кроку 4 фото віддаються одразу.

## Перевірка

```bash
railway ssh -s EnergyUA -- bash /app/scripts/railway-media-diagnose.sh
```

Відкрий на сайті кілька карток товарів in-heat. Прямий URL `https://<домен>/api/media/<ім'я з push/>` має віддавати `200`.

Коли все на місці, `storage/manual-download/` можна видалити.
