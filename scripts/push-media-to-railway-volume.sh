#!/usr/bin/env bash
# Локальний storage/media → volume на Railway (через stdin у railway ssh).
# Потрібен повний локальний каталог з тими самими іменами файлів, що в БД (/api/media/{sha256}.ext).
#
#   npm run db:push-media-railway
#   RAILWAY_REMOTE_MEDIA_ROOT=/data/media npm run db:push-media-railway -- OtherService
#
# Прогрес:
#   brew install pv   → смуга / МБ / швидкість по gzip-потоку
#   без pv            → «серцебиття» кожні PUSH_MEDIA_HEARTBEAT_SEC (12) с + tar -v (імена файлів)
#   PUSH_MEDIA_QUIET=1 — без pv, без heartbeat, без -v (лише тихий tar)
#   PUSH_MEDIA_STAGING=/tmp/eh.tgz — куди на контейнері тимчасово писати архів (типово /tmp, ~розмір gzip)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${1:-EnergyUA}"
REMOTE_ROOT="${RAILWAY_REMOTE_MEDIA_ROOT:-/data/media}"

cd "$ROOT"
if [ ! -d storage/media ]; then
  echo "Немає каталогу storage/media (очікується $ROOT/storage/media)" >&2
  exit 1
fi
# Будь-яка глибина (не лише корінь): mirror кладе sha256.ext у storage/media, але перевірка maxdepth=1 давала хибне «порожньо».
first_file="$(find storage/media -type f 2>/dev/null | head -n 1 || true)"
if [ -z "$first_file" ]; then
  echo "storage/media: не знайдено жодного файлу (find -type f)." >&2
  echo "Каталог: $ROOT/storage/media" >&2
  ls -la storage/media 2>&1 | head -20 >&2 || true
  echo "Якщо файли точно є — перевір права читання: chmod -R u+rX storage/media" >&2
  exit 1
fi

if [ -z "$REMOTE_ROOT" ]; then
  echo "REMOTE_ROOT порожній — перевір RAILWAY_REMOTE_MEDIA_ROOT" >&2
  exit 1
fi

FILE_COUNT="$(find storage/media -type f 2>/dev/null | wc -l | tr -d ' ')"
SIZE_H="$(du -sh storage/media 2>/dev/null | awk '{print $1}')"
echo "[push-media] файлів: ${FILE_COUNT}, розмір на диску (орієнтир): ${SIZE_H} — gzip-потік буде менший; передача часто 5–30+ хв при тисячах файлів" >&2
echo "Архів storage/media → railway ssh -s ${SERVICE} → ${REMOTE_ROOT}"
echo "(якщо обрив або таймаут — спробуй менший набір або повтори; великі каталоги можуть йти хвилини)"
# Не використовуємо sh -c: railway ssh часто ламає квотування, тоді mkdir отримує порожній шлях («missing operand»),
# а локальний tar отримує «Write error» через закритий пайп.
echo "Крок 1/2: mkdir -p на віддаленому хості…"
railway ssh -s "$SERVICE" -- mkdir -p "$REMOTE_ROOT"

# 1) Стрім у tar xzf - на volume дає backpressure (~0 B/s у pv).
# 2) Один рядок bash -c на railway ssh ламається (rm без шляху, panic Rust на $'…').
# Тому: окремі виклики — rm, dd (stdin→файл), tar xzf, rm; без оболонки на віддаленій стороні.
STAGING_PATH="${PUSH_MEDIA_STAGING:-/tmp/eh-media-staging.tgz}"

echo "Крок 2a: прибрати старий staging на контейнері…" >&2
railway ssh -s "$SERVICE" -- rm -f -- "$STAGING_PATH"

# dd без if= читає stdin; of= один аргумент (шлях без пробілів надійніший).
stream_to_staging() {
  railway ssh -s "$SERVICE" -- dd bs=1048576 "of=${STAGING_PATH}"
}

echo "Крок 2b: gzip-потік → ${STAGING_PATH} (dd)…" >&2
if [ "${PUSH_MEDIA_QUIET:-}" = "1" ]; then
  tar czf - -C storage/media . | stream_to_staging
else
  if command -v pv >/dev/null 2>&1; then
    echo "[push-media] pv: фаза запису на контейнер; потім крок 2c (розпаковка) — без оновлення pv" >&2
    tar czf - -C storage/media . | pv -f -i 2 -trb | stream_to_staging
  else
    HB_SEC="${PUSH_MEDIA_HEARTBEAT_SEC:-12}"
    echo "[push-media] без pv: heartbeat кожні ${HB_SEC} с + tar -v; brew install pv — для МБ/с" >&2
    (
      t0="$(date +%s)"
      while sleep "$HB_SEC"; do
        now="$(date +%s)"
        echo "[push-media] передача… $((now - t0)) с, $(date '+%H:%M:%S')" >&2
      done
    ) &
    HB_PID=$!
    trap 'kill "$HB_PID" 2>/dev/null || true; wait "$HB_PID" 2>/dev/null || true' EXIT INT TERM
    tar czvf - -C storage/media . | stream_to_staging
    kill "$HB_PID" 2>/dev/null || true
    wait "$HB_PID" 2>/dev/null || true
    trap - EXIT INT TERM
  fi
fi

echo "Крок 2c: tar xzf на volume ${REMOTE_ROOT}…" >&2
if ! railway ssh -s "$SERVICE" -- tar xzf "$STAGING_PATH" -C "$REMOTE_ROOT"; then
  echo "[push-media] розпаковка не вдалася; staging лишився: ${STAGING_PATH}" >&2
  exit 1
fi

echo "Крок 2d: видалити staging…" >&2
railway ssh -s "$SERVICE" -- rm -f -- "$STAGING_PATH"

echo "Готово. Перевір: railway ssh -s $SERVICE -- bash /app/scripts/railway-media-diagnose.sh"
