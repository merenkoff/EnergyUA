/**
 * Завантажує зовнішні URL з product_images у MEDIA_ROOT, оновлює url на /api/media/{sha256}.{ext}.
 * Ідемпотентно: вже локальні /api/media/ пропускає; файл за тим самим sha256 не качає повторно.
 *
 *   npx tsx scripts/cli/mirror-product-images.ts
 *   MIRROR_PRODUCT_IMAGES=yes у Railway pre-deploy (одноразово, потім прибрати змінну)
 */
import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, readdir, rename, unlink } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MEDIA_ROOT = process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), "storage", "media");
const MAX_BYTES = Number(process.env.MIRROR_IMAGE_MAX_BYTES || String(15 * 1024 * 1024));
const CONCURRENCY = Math.min(16, Math.max(1, Number(process.env.MIRROR_IMAGE_CONCURRENCY || 6)));
const USER_AGENT =
  process.env.MIRROR_IMAGE_USER_AGENT ||
  "ElectroHeatBot/1.0 (+product image mirror)";

function hashUrl(u: string): string {
  return createHash("sha256").update(u, "utf8").digest("hex");
}

function extFromContentType(ct: string | null): string {
  if (!ct) return "bin";
  const s = ct.split(";")[0].trim().toLowerCase();
  if (s.includes("jpeg")) return "jpg";
  if (s.includes("png")) return "png";
  if (s.includes("webp")) return "webp";
  if (s.includes("gif")) return "gif";
  return "bin";
}

function extFromPathname(urlStr: string): string | null {
  try {
    const p = new URL(urlStr).pathname.toLowerCase();
    const m = p.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/);
    if (!m) return null;
    return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    return null;
  }
}

const existingNamesCache = new Set<string>();

async function loadNameCache(): Promise<void> {
  try {
    const names = await readdir(MEDIA_ROOT);
    existingNamesCache.clear();
    for (const n of names) {
      if (!n.startsWith(".")) existingNamesCache.add(n);
    }
  } catch {
    await mkdir(MEDIA_ROOT, { recursive: true });
    existingNamesCache.clear();
  }
}

async function findExistingFileForHash(hash: string): Promise<string | null> {
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "bin"]) {
    const name = `${hash}.${ext}`;
    if (existingNamesCache.has(name)) return name;
  }
  const onDisk = (await readdir(MEDIA_ROOT).catch(() => [])).filter((n) => n.startsWith(`${hash}.`));
  for (const n of onDisk) {
    existingNamesCache.add(n);
    return n;
  }
  return null;
}

async function downloadToTmp(url: string, tmpPath: string): Promise<{ contentType: string | null }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const ws = createWriteStream(tmpPath);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      total += value.length;
      if (total > MAX_BYTES) throw new Error(`body > ${MAX_BYTES} bytes`);
      await new Promise<void>((ok, fail) => {
        ws.write(Buffer.from(value), (err?: Error | null) => (err ? fail(err) : ok()));
      });
    }
  } finally {
    reader.releaseLock();
  }
  await new Promise<void>((ok, fail) => ws.end((err?: Error | null) => (err ? fail(err) : ok())));
  return { contentType: res.headers.get("content-type") };
}

function isExternalImageUrl(u: string): boolean {
  if (!u.startsWith("http://") && !u.startsWith("https://")) return false;
  if (u.includes("/api/media/")) return false;
  return true;
}

async function main() {
  await mkdir(MEDIA_ROOT, { recursive: true });
  await loadNameCache();

  const images = await prisma.productImage.findMany({
    select: { id: true, url: true },
  });

  const uniqueUrls = new Set<string>();
  for (const row of images) {
    if (isExternalImageUrl(row.url)) uniqueUrls.add(row.url);
  }

  console.log(`MEDIA_ROOT=${MEDIA_ROOT}`);
  console.log(`Унікальних зовнішніх URL: ${uniqueUrls.size}`);

  let reused = 0;
  let downloaded = 0;
  let failed = 0;

  const urls = [...uniqueUrls];

  async function processOne(url: string): Promise<void> {
    const hash = hashUrl(url);
    let filename = await findExistingFileForHash(hash);

    if (!filename) {
      const tmp = path.join(MEDIA_ROOT, `.tmp-${hash}-${process.pid}-${Math.random().toString(36).slice(2)}`);
      try {
        const { contentType } = await downloadToTmp(url, tmp);
        let ext = extFromPathname(url) || extFromContentType(contentType) || "bin";
        if (ext === "jpeg") ext = "jpg";
        filename = `${hash}.${ext}`;
        const finalPath = path.join(MEDIA_ROOT, filename);
        await rename(tmp, finalPath);
        existingNamesCache.add(filename);
        downloaded += 1;
      } catch (e) {
        failed += 1;
        console.error(`[mirror] FAIL ${url.slice(0, 96)}`, e instanceof Error ? e.message : e);
        try {
          await unlink(tmp);
        } catch {
          /* ignore */
        }
        return;
      }
    } else {
      reused += 1;
    }

    const newUrl = `/api/media/${filename}`;
    const r = await prisma.productImage.updateMany({
      where: { url },
      data: { url: newUrl },
    });
    if (r.count === 0) console.warn(`[mirror] updateMany 0 rows for url (можливо вже оновлено)`);
  }

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(processOne));
    console.log(`… ${Math.min(i + CONCURRENCY, urls.length)} / ${urls.length}`);
  }

  console.log(
    `Готово. Нових завантажень: ${downloaded}, повторне використання файлу: ${reused}, помилок: ${failed}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
