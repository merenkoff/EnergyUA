/**
 * Докачує файли на MEDIA_ROOT для рядків, де url уже /api/media/…, файлу немає, але є sourceUrl (після mirror з новою колонкою).
 * Не допоможе для старих рядків без source_url — тоді scripts/push-media-to-railway-volume.sh з локального storage/media.
 */
import { createHash } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { getMediaRoot, isSafeMediaFilename, joinMediaFile } from "@/lib/mediaStorage";

const prisma = new PrismaClient();

const MEDIA_ROOT = getMediaRoot();
const MAX_BYTES = Number(process.env.MIRROR_IMAGE_MAX_BYTES || String(15 * 1024 * 1024));
const USER_AGENT =
  process.env.MIRROR_IMAGE_USER_AGENT || "ElectroHeatBot/1.0 (+product image repair)";

function hashUrl(u: string): string {
  return createHash("sha256").update(u, "utf8").digest("hex");
}

async function downloadToTmp(url: string, tmpPath: string): Promise<void> {
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
}

function filenameFromLocalUrl(url: string): string | null {
  const prefix = "/api/media/";
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length).split("?")[0]?.trim() ?? "";
  return isSafeMediaFilename(name) ? name : null;
}

function isHttp(u: string): boolean {
  return u.startsWith("http://") || u.startsWith("https://");
}

async function main() {
  await mkdir(MEDIA_ROOT, { recursive: true });

  const rows = await prisma.productImage.findMany({
    where: { url: { startsWith: "/api/media/" } },
    select: { id: true, url: true, sourceUrl: true },
  });

  let skippedOk = 0;
  let skippedNoSource = 0;
  let skippedBadHash = 0;
  let repaired = 0;
  let failed = 0;

  for (const row of rows) {
    const name = filenameFromLocalUrl(row.url);
    if (!name) continue;
    const full = joinMediaFile(MEDIA_ROOT, name);
    if (!full) continue;
    try {
      await stat(full);
      skippedOk += 1;
      continue;
    } catch {
      /* missing */
    }

    const src = row.sourceUrl?.trim();
    if (!src || !isHttp(src)) {
      skippedNoSource += 1;
      continue;
    }

    const expectedHash = name.slice(0, 64);
    if (hashUrl(src) !== expectedHash) {
      skippedBadHash += 1;
      console.warn(`[repair] hash mismatch id=${row.id} file=${name.slice(0, 16)}…`);
      continue;
    }

    const tmp = path.join(MEDIA_ROOT, `.tmp-repair-${row.id}-${process.pid}-${Math.random().toString(36).slice(2)}`);
    try {
      await downloadToTmp(src, tmp);
      await rename(tmp, full);
      repaired += 1;
      if (repaired % 100 === 0) console.log(`[repair] … ${repaired}`);
    } catch (e) {
      failed += 1;
      console.error(`[repair] FAIL ${row.id} ${src.slice(0, 80)}`, e instanceof Error ? e.message : e);
      try {
        await unlink(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  console.log(
    `[repair] Готово. Уже на диску: ${skippedOk}, без source_url: ${skippedNoSource}, hash/ext mismatch: ${skippedBadHash}, відновлено: ${repaired}, помилок: ${failed}`,
  );
  if (skippedNoSource > 0 && repaired === 0) {
    console.log(
      "[repair] Для рядків без source_url скопіюй локальний storage/media на volume: npm run db:push-media-railway",
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
