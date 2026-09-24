/**
 * Ручне завантаження фото товарів з донора, закритого перевіркою Cloudflare (in-heat.kiev.ua).
 * Railway і mirror отримують сторінку «Just a moment…», тож фото качає людина у своєму браузері,
 * а цей скрипт готує список і приймає результат. Інструкція: docs/MANUAL-IMAGE-DOWNLOAD.md.
 *
 *   npm run db:manual-images:prepare                     # URL з data/scrape/in-heat-catalog-DETAIL.json
 *   npm run db:manual-images:prepare -- --from-db        # URL з product_images (DATABASE_URL)
 *   npm run db:manual-images:ingest -- ~/Downloads/in-heat.kiev.ua-images-*.zip
 *
 * prepare: --host in-heat.kiev.ua, --manifest <json> (можна кілька), --from-db.
 * ingest: ZIP-и або каталоги з файлами {sha256}.{ext}; --host той самий, що в prepare.
 *
 * Робочі файли: storage/manual-download/<host>/ (urls.json, downloader.js, push/).
 * Файли пишуться в MEDIA_ROOT (локально storage/media) під тими іменами, які дає mirror,
 * тож mirror на Railway після `db:push-media-railway` лише переключить URL у БД, нічого не качаючи.
 */
import { link, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { inflateRawSync } from "zlib";
import { getMediaRoot, isSafeMediaFilename, joinMediaFile } from "@/lib/mediaStorage";
import { MEDIA_FILE_EXTS, extFromPathname, hashUrl } from "../lib/mediaFileNaming";

const DEFAULT_HOST = "in-heat.kiev.ua";
const DEFAULT_MANIFEST = "data/scrape/in-heat-catalog-DETAIL.json";
const MAX_BYTES = 15 * 1024 * 1024;
const SNIPPET_TEMPLATE = path.join(__dirname, "..", "browser", "manual-image-downloader.js");

type Item = { url: string; hash: string; ext: string | null };
type UrlsFile = { host: string; source: string; createdAt: string; items: Item[] };

function log(msg: string) {
  console.log(`[manual-images] ${msg}`);
}

function rel(p: string): string {
  return path.relative(process.cwd(), p) || ".";
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const manifests: string[] = [];
  let host = DEFAULT_HOST;
  let fromDb = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") host = argv[++i] ?? host;
    else if (a === "--manifest") manifests.push(argv[++i]);
    else if (a === "--from-db") fromDb = true;
    else if (a.startsWith("--")) throw new Error(`Невідома опція ${a}`);
    else positional.push(a);
  }
  return { command: positional[0], rest: positional.slice(1), host, fromDb, manifests };
}

function workDir(host: string): string {
  return path.join(process.cwd(), "storage", "manual-download", host);
}

function sameHost(u: string, host: string): boolean {
  try {
    return new URL(u).host === host;
  } catch {
    return false;
  }
}

function itemKey(it: Item): string {
  return it.ext ? `${it.hash}.${it.ext}` : it.hash;
}

async function itemsFromManifests(files: string[], host: string): Promise<Item[]> {
  const out = new Map<string, Item>();
  for (const f of files) {
    const data = JSON.parse(await readFile(f, "utf8"));
    const products: { images?: { url?: string }[] }[] = Array.isArray(data) ? data : (data.products ?? []);
    for (const p of products) {
      for (const img of p.images ?? []) {
        const url = img.url?.trim();
        if (!url || !sameHost(url, host)) continue;
        const it = { url, hash: hashUrl(url), ext: extFromPathname(url) };
        out.set(itemKey(it), it);
      }
    }
  }
  return [...out.values()];
}

/** Рядки ще з зовнішнім URL донора + рядки, уже переключені на /api/media, у яких source_url з донора. */
async function itemsFromDb(host: string): Promise<Item[]> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.productImage.findMany({ select: { url: true, sourceUrl: true } });
    const out = new Map<string, Item>();
    for (const row of rows) {
      if (sameHost(row.url, host)) {
        const it = { url: row.url, hash: hashUrl(row.url), ext: extFromPathname(row.url) };
        out.set(itemKey(it), it);
        continue;
      }
      const src = row.sourceUrl?.trim();
      if (!src || !sameHost(src, host) || !row.url.startsWith("/api/media/")) continue;
      // Ім'я файлу беремо саме з url: під ним сайт його й шукатиме.
      const name = row.url.slice("/api/media/".length).split("?")[0].toLowerCase();
      if (!isSafeMediaFilename(name)) continue;
      const dot = name.indexOf(".");
      const it = { url: src, hash: name.slice(0, dot), ext: name.slice(dot + 1) };
      out.set(itemKey(it), it);
    }
    return [...out.values()];
  } finally {
    await prisma.$disconnect();
  }
}

/** Ім'я наявного файлу для item так само, як його шукає mirror (findExistingFileForHash). */
function presentName(it: Item, names: Set<string>): string | null {
  if (it.ext) return names.has(`${it.hash}.${it.ext}`) ? `${it.hash}.${it.ext}` : null;
  for (const ext of MEDIA_FILE_EXTS) {
    if (names.has(`${it.hash}.${ext}`)) return `${it.hash}.${ext}`;
  }
  return null;
}

async function mediaNames(root: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const n of await readdir(root).catch(() => [] as string[])) {
    if (!isSafeMediaFilename(n)) continue;
    const st = await stat(path.join(root, n)).catch(() => null);
    if (st?.isFile() && st.size > 0) names.add(n);
  }
  return names;
}

async function linkOrCopy(src: string, dest: string) {
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

/**
 * Звіряє urls.json з MEDIA_ROOT: сніпет лише для відсутніх фото, push/ зі всіма наявними
 * (щоб на volume потрапили й ті, що вже лежали локально до ручного завантаження).
 */
async function refresh(host: string) {
  const dir = workDir(host);
  const urlsPath = path.join(dir, "urls.json");
  const urls: UrlsFile = JSON.parse(await readFile(urlsPath, "utf8"));
  const root = getMediaRoot();
  const names = await mediaNames(root);

  const missing: Item[] = [];
  const present = new Set<string>();
  for (const it of urls.items) {
    const name = presentName(it, names);
    if (name) present.add(name);
    else missing.push(it);
  }

  log(`MEDIA_ROOT=${root}`);
  log(`${host}: потрібно фото ${urls.items.length}, уже є локально ${urls.items.length - missing.length}, бракує ${missing.length} (джерело списку: ${urls.source})`);

  const snippetPath = path.join(dir, "downloader.js");
  if (missing.length) {
    const template = await readFile(SNIPPET_TEMPLATE, "utf8");
    const config = { host, items: missing.map((it) => [it.url, it.hash, it.ext]) };
    await writeFile(snippetPath, template.replace("/*__CONFIG__*/ null", () => JSON.stringify(config)));
    log(`Сніпет для браузера: ${rel(snippetPath)} (${missing.length} фото)`);
  } else {
    await rm(snippetPath, { force: true });
  }

  const pushDir = path.join(dir, "push");
  await rm(pushDir, { recursive: true, force: true });
  await mkdir(pushDir, { recursive: true });
  let bytes = 0;
  for (const name of present) {
    const src = path.join(root, name);
    await linkOrCopy(src, path.join(pushDir, name));
    bytes += (await stat(src)).size;
  }
  log(`Для Railway підготовлено ${present.size} файлів (${(bytes / 1048576).toFixed(1)} МБ): ${rel(pushDir)}`);

  console.log("");
  if (missing.length) {
    console.log("Далі (докладно: docs/MANUAL-IMAGE-DOWNLOAD.md):");
    console.log(`  1) Скопіюй сніпет:  pbcopy < ${rel(snippetPath)}`);
    console.log(`  2) Відкрий https://${host}/ у Chrome, пройди «Just a moment…», DevTools → Console, встав, Enter.`);
    console.log(`  3) Імпортуй ZIP:    npm run db:manual-images:ingest -- ~/Downloads/${host}-images-*.zip`);
    console.log("  Коли «бракує 0» (або решту вирішив не качати), відправ push/ на Railway:");
  } else {
    console.log("Усі фото є локально. Відправ їх на Railway:");
  }
  console.log(`  PUSH_MEDIA_DIR=${rel(pushDir)} npm run db:push-media-railway`);
  console.log(
    "  railway ssh -s EnergyUA -- env MEDIA_ROOT=/data/media /app/node_modules/.bin/tsx /app/scripts/cli/mirror-product-images.ts",
  );
}

async function prepare(host: string, fromDb: boolean, manifests: string[]) {
  const sources = manifests.length ? manifests : [DEFAULT_MANIFEST];
  const items = fromDb ? await itemsFromDb(host) : await itemsFromManifests(sources, host);
  if (!items.length) {
    throw new Error(`Не знайдено жодного URL фото з хостом ${host} (${fromDb ? "БД" : sources.join(", ")})`);
  }
  const dir = workDir(host);
  await mkdir(dir, { recursive: true });
  const urls: UrlsFile = {
    host,
    source: fromDb ? "product_images (DATABASE_URL)" : sources.join(", "),
    createdAt: new Date().toISOString(),
    items,
  };
  await writeFile(path.join(dir, "urls.json"), JSON.stringify(urls, null, 1));
  await refresh(host);
}

function sniffImage(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (b.length >= 6 && b.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  return null;
}

/** Мінімальне читання ZIP (stored/deflate, без zip64): ZIP від сніпета або перепакований вручну. */
function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("це не ZIP (немає End of Central Directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("пошкоджений ZIP (central directory)");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1 || csize === 0xffffffff || localOffset === 0xffffffff) {
      console.warn(`[manual-images] пропуск ${name}: шифрування або zip64 не підтримуються`);
      continue;
    }
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else console.warn(`[manual-images] пропуск ${name}: метод стиснення ${method}`);
  }
  return out;
}

async function* inputEntries(input: string): AsyncGenerator<{ name: string; data: Buffer }> {
  const st = await stat(input);
  if (st.isDirectory()) {
    for (const relName of await readdir(input, { recursive: true })) {
      const full = path.join(input, relName);
      if ((await stat(full)).isFile()) yield { name: relName, data: await readFile(full) };
    }
    return;
  }
  yield* readZipEntries(await readFile(input));
}

async function ingest(host: string, inputs: string[]) {
  if (!inputs.length) throw new Error("Вкажи ZIP або каталог: npm run db:manual-images:ingest -- ~/Downloads/<файл>.zip");
  const root = getMediaRoot();
  await mkdir(root, { recursive: true });
  let added = 0;
  let already = 0;
  let rejected = 0;

  for (const input of inputs) {
    log(`Імпорт ${input}`);
    for await (const { name, data } of inputEntries(input)) {
      const base = path.basename(name);
      if (base.startsWith(".") || name.includes("__MACOSX")) continue;
      const fname = base.toLowerCase();
      const full = joinMediaFile(root, fname);
      if (!full) {
        rejected += 1;
        console.warn(`[manual-images] пропуск ${name}: ім'я не у форматі {sha256}.{ext}`);
        continue;
      }
      if (!data.length || data.length > MAX_BYTES || !sniffImage(data)) {
        rejected += 1;
        console.warn(`[manual-images] пропуск ${name}: не зображення або завеликий файл`);
        continue;
      }
      const existing = await stat(full).catch(() => null);
      if (existing && existing.size > 0) {
        already += 1;
        continue;
      }
      const tmp = path.join(root, `.tmp-manual-${process.pid}-${fname}`);
      await writeFile(tmp, data);
      await rename(tmp, full);
      added += 1;
    }
  }
  log(`Додано в MEDIA_ROOT: ${added}, уже були: ${already}, відхилено: ${rejected}`);

  const urlsPath = path.join(workDir(host), "urls.json");
  if (await stat(urlsPath).catch(() => null)) {
    await refresh(host);
  } else {
    log(`Немає ${rel(urlsPath)}: запусти npm run db:manual-images:prepare, щоб звірити список і зібрати push/.`);
  }
}

async function main() {
  const { command, rest, host, fromDb, manifests } = parseArgs(process.argv.slice(2));
  if (command === "prepare") await prepare(host, fromDb, manifests);
  else if (command === "ingest") await ingest(host, rest);
  else throw new Error("Команда: prepare | ingest (див. docs/MANUAL-IMAGE-DOWNLOAD.md)");
}

main().catch((e) => {
  console.error(`[manual-images] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
