/**
 * Діагностика сховища фото для Railway / локально.
 * Увесь вивід з префіксом [media-diagnose] — скопіюй повністю в чат.
 *
 *   npm run db:media-diagnose
 *   railway ssh -s <app> -- bash /app/scripts/railway-media-diagnose.sh   # у контейнері (cwd SSH ігнорується)
 *
 * Важливо: `railway run` виконує команду НА ТВОЄМУ КОМП'ЮТЕРІ з підставленими змінними з Railway.
 * Тоді недоступні postgres.railway.internal і каталог /data/media (volume) — це нормально, див. hint у логах.
 */
import { execSync } from "node:child_process";
import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { getMediaRoot, isSafeMediaFilename, joinMediaFile } from "@/lib/mediaStorage";

const prisma = new PrismaClient();

function log(section: string, msg: string) {
  console.log(`[media-diagnose] ${section} ${msg}`);
}

function dbHostnameOnly(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

function isInternalRailwayDbHost(host: string | null): boolean {
  return !!host && host.endsWith(".railway.internal");
}

let railwayRunLocalHintShown = false;

function hintRailwayRunIsLocal() {
  if (railwayRunLocalHintShown) return;
  railwayRunLocalHintShown = true;
  log(
    "hint",
    "`railway run` запускає npm/tsx на ТВОЄМУ Mac/PC, а не в контейнері Railway. Тому: (1) немає змонтованого volume — шлях /data/media не існує; (2) postgres.railway.internal недоступний ззовні.",
  );
  log("hint-fix-ssh", "Повна діагностика (БД + файли на volume): railway ssh -s <сервіс-застосунку> -- npm run db:media-diagnose");
  log("hint-fix-public-db", "Лише БД з локальної машини: у Variables сервісу Postgres скопіюй публічний DATABASE_URL (хост на кшталт *.up.railway.app, часто sslmode=require). Потім: DATABASE_URL='...' MEDIA_ROOT=./storage/media npm run db:media-diagnose");
}

function filenameFromDbUrl(url: string): string | null {
  const prefix = "/api/media/";
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length).split("?")[0]?.trim() ?? "";
  return isSafeMediaFilename(name) ? name : null;
}

async function main() {
  const mediaRoot = getMediaRoot();
  const testFile = path.join(mediaRoot, ".electroheat-write-test");
  const dbHost = process.env.DATABASE_URL ? dbHostnameOnly(process.env.DATABASE_URL) : null;

  log("===", "0. Старт");
  log("cwd", process.cwd());
  log("NODE_ENV", process.env.NODE_ENV ?? "(не задано)");
  log("DATABASE_URL", process.env.DATABASE_URL ? "задано (масковано: є)" : "НЕМАЄ — потрібен для кроку БД");
  if (dbHost) log("db-hostname", `${dbHost} (лише хост; якщо *.railway.internal — з Mac не підключишся через railway run)`);
  log("MEDIA_ROOT", mediaRoot);
  log("MIRROR_PRODUCT_IMAGES", process.env.MIRROR_PRODUCT_IMAGES ?? "(не задано)");
  if (process.env.RAILWAY_ENVIRONMENT) log("RAILWAY_ENVIRONMENT", process.env.RAILWAY_ENVIRONMENT);
  if (process.env.RAILWAY_SERVICE_NAME) log("RAILWAY_SERVICE_NAME", process.env.RAILWAY_SERVICE_NAME);

  log("===", "1. Файлова система");
  try {
    await mkdir(mediaRoot, { recursive: true });
    log("mkdir", `OK (recursive): ${mediaRoot}`);
  } catch (e) {
    log("mkdir", `FAIL: ${e instanceof Error ? e.message : e}`);
    if (mediaRoot.startsWith("/data") && process.env.RAILWAY_ENVIRONMENT) hintRailwayRunIsLocal();
  }

  try {
    await access(mediaRoot);
    const st = await stat(mediaRoot);
    log("stat", `isDirectory=${st.isDirectory()} mode=${st.mode.toString(8)}`);
  } catch (e) {
    log("stat", `FAIL: ${e instanceof Error ? e.message : e}`);
    if (mediaRoot.startsWith("/data") && process.env.RAILWAY_ENVIRONMENT) hintRailwayRunIsLocal();
  }

  try {
    await writeFile(testFile, `ok ${Date.now()}`, "utf8");
    await unlink(testFile);
    log("write-test", "OK (створено й видалено .electroheat-write-test)");
  } catch (e) {
    log("write-test", `FAIL: ${e instanceof Error ? e.message : e}`);
    if (mediaRoot.startsWith("/data") && process.env.RAILWAY_ENVIRONMENT) hintRailwayRunIsLocal();
  }

  try {
    const out = execSync(`df -h "${mediaRoot}" 2>/dev/null || true`, { encoding: "utf8", maxBuffer: 4096 });
    if (out.trim()) log("df", `\n${out.trim()}`);
    else log("df", "(немає виводу df — ок для macOS без GNU df)");
  } catch {
    log("df", "(пропущено)");
  }

  let fileNames: string[] = [];
  try {
    const all = await readdir(mediaRoot);
    fileNames = all.filter((n) => !n.startsWith(".") && isSafeMediaFilename(n));
    log("files-on-disk", `всього валідних імен (sha256.ext): ${fileNames.length}`);
    if (fileNames.length > 0) {
      log("sample-files", fileNames.slice(0, 3).join(", ") + (fileNames.length > 3 ? " …" : ""));
    }
  } catch (e) {
    log("readdir", `FAIL: ${e instanceof Error ? e.message : e}`);
    if (mediaRoot.startsWith("/data") && process.env.RAILWAY_ENVIRONMENT) hintRailwayRunIsLocal();
  }

  log("===", "2. База даних (product_images)");
  if (!process.env.DATABASE_URL) {
    log("skip-db", "немає DATABASE_URL");
    log("===", "КІНЕЦЬ (без БД)");
    return;
  }

  let total = 0;
  let external = 0;
  let local = 0;
  try {
    total = await prisma.productImage.count();
    external = await prisma.productImage.count({
      where: { OR: [{ url: { startsWith: "http://" } }, { url: { startsWith: "https://" } }] },
    });
    local = await prisma.productImage.count({ where: { url: { startsWith: "/api/media/" } } });
    log("counts", `total=${total} external_http(s)=${external} local_/api/media/=${local}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("counts", `FAIL: ${msg}`);
    if (isInternalRailwayDbHost(dbHost) || msg.includes("railway.internal")) {
      hintRailwayRunIsLocal();
      log("hint-db", "Або встав публічний рядок підключення з Railway → Postgres → Connect / Variables (не використовуй *.railway.internal з домашньої мережі).");
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  const rows = await prisma.productImage.findMany({
    where: { url: { startsWith: "/api/media/" } },
    select: { id: true, url: true },
  });

  const needed = new Set<string>();
  for (const r of rows) {
    const fn = filenameFromDbUrl(r.url);
    if (fn) needed.add(fn);
  }
  log("unique-local-filenames", String(needed.size));

  let missing = 0;
  let present = 0;
  const missingSamples: string[] = [];
  for (const fn of needed) {
    const full = joinMediaFile(mediaRoot, fn);
    if (!full) continue;
    try {
      await stat(full);
      present += 1;
    } catch {
      missing += 1;
      if (missingSamples.length < 15) missingSamples.push(fn);
    }
  }

  log("===", "3. Відповідність БД → файли на диску");
  log("match", `файл є на диску: ${present} | відсутній: ${missing}`);
  if (missingSamples.length) {
    log("missing-sample", missingSamples.join("\n[media-diagnose] missing-sample "));
  }

  log("===", "4. Перевірка маршруту (опційно)");
  const site = process.env.PUBLIC_SITE_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
  if (site) {
    const base = site.startsWith("http") ? site : `https://${site}`;
    const sample = missingSamples[0] ?? [...needed][0];
    if (sample) {
      const url = `${base}/api/media/${sample}`;
      log("curl-hint", `перевір у браузері або: curl -sI "${url}"`);
    }
  } else {
    log("curl-hint", "задай PUBLIC_SITE_URL або RAILWAY_PUBLIC_DOMAIN для підказки curl");
  }

  log("===", "ПІДСУМОК");
  if (missing === 0 && needed.size > 0) {
    log("result", "OK: усі записи /api/media/ мають файли на диску (за поточним MEDIA_ROOT).");
  } else if (missing > 0) {
    log(
      "result",
      "ПРОБЛЕМА: у БД є /api/media/… без файлів. Швидко: з машини з повним storage/media виконай npm run db:push-media-railway. Якщо в БД є source_url — npm run db:repair-images у контейнері або з публічним DATABASE_URL. Інакше реімпорт або бекап БД.",
    );
  } else if (needed.size === 0 && external > 0) {
    log("result", "У БД лише зовнішні URL — запусти mirror (MIRROR_PRODUCT_IMAGES=yes або npm run db:mirror-images).");
  } else if (needed.size === 0 && external === 0 && total > 0) {
    log("result", "Дивні URL у product_images — перевір дані.");
  } else {
    log("result", "Немає локальних /api/media/ записів або порожня таблиця.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("[media-diagnose] FATAL", e);
    prisma.$disconnect();
    process.exit(1);
  });
