/**
 * Стирає з файлів фото накладений підпис донора (назву сайта).
 *
 *   npm run img:dewatermark -- --manifests                 # список фото з data/scrape, файли з MEDIA_ROOT
 *   npm run img:dewatermark                                # список фото з БД
 *   npm run img:dewatermark -- --manifests --apply         # переписати файли (оригінали — в резерв)
 *   npm run img:dewatermark -- --manifests --band          # + запасний шаблон «нижня смуга» (Prom)
 *   npm run img:dewatermark -- --restore                   # повернути оригінали з резерву
 *
 * Без `--apply` нічого не змінює: друкує звіт і кладе в out/dewatermark зразки «до / після».
 * Рядки БД не чіпаються взагалі: файл лишається з тим самим іменем, url і source_url ті самі.
 *
 * Оригінали копіюються в MEDIA_ORIGINALS_ROOT (типово storage/media-original), а оброблені
 * файли записуються у storage/media-dewatermarked.json — щоб повторний запуск їх не чіпав
 * і не будував шаблон по вже почищених фото.
 *
 * Як шукається й прибирається знак — див. scripts/lib/watermarkRemoval.ts і docs/IMAGE-WATERMARKS.md.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { imageDonor, manifestImageRows, type ImageDonor, type ImageRow } from "../lib/imageAnalysis";
import {
  DEFAULT_MODEL_OPTIONS,
  buildWatermarkModel,
  modelSpaceGradient,
  removeWatermark,
  validateModel,
  WatermarkAccumulator,
  zoneStats,
  type ModelGeometry,
  type WatermarkModel,
  type ZoneHit,
} from "../lib/watermarkRemoval";

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const value = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1] ?? null;
};

const MANIFESTS = has("--manifests");
const APPLY = has("--apply");
const RESTORE = has("--restore");
/**
 * Нижня смуга — запасний режим для донорів, що масштабують знак із шириною фото (Prom).
 * Вимкнений типово: на фото різних пропорцій напис лягає не піксель у піксель,
 * і шаблон виходить приблизний, тож вмикати його варто, лише подивившись маску в out/.
 */
const BAND = has("--band");
const ONLY_DONOR = value("--donor");
const LIMIT = Number(value("--limit") || 0);
const SAMPLES = Number(value("--samples") || 12);
const OUT_DIR = value("--out") || path.join(process.cwd(), "out", "dewatermark");
const DILATE = Number(process.env.IMAGE_WM_DILATE || value("--dilate") || 2);
const JPEG_QUALITY = Number(process.env.IMAGE_WM_JPEG_QUALITY || 92);
/** Розкид кольору навколо знака, до якого тло вважаємо рівним і закриваємо всю зону. */
const FLAT_BACKGROUND = Number(process.env.IMAGE_WM_FLAT_BG || 12);
/**
 * На скільки пікселів шаблон може «поїхати» на конкретному фото. Підпис у донора стоїть не
 * завжди піксель у піксель, тож без цього пошуку частина фото лишалася б із написом.
 */
const MAX_SHIFT = Number(process.env.IMAGE_WM_SHIFT || 5);
/** Скільки разів перебудовувати шаблон по тих фото, де знака ще не знайшли (різні варіанти підпису). */
const MAX_ROUNDS = Number(process.env.IMAGE_WM_ROUNDS || 4);
/** Копіювати оригінал перед записом. Вимикати варто, лише якщо на volume бракує місця. */
const BACKUP = process.env.IMAGE_WM_BACKUP !== "no";
/** Смуга внизу кадру для донорів, що масштабують знак із шириною фото (Prom). */
const BAND_REF_WIDTH = 500;
const BAND_HEIGHT = 140;

const MEDIA_ROOT = process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), "storage", "media");
const ORIGINALS_ROOT = process.env.MEDIA_ORIGINALS_ROOT?.trim() || path.join(path.dirname(MEDIA_ROOT), "media-original");
const STATE_FILE = path.join(path.dirname(MEDIA_ROOT), "media-dewatermarked.json");

const MODEL_OPTIONS = {
  ...DEFAULT_MODEL_OPTIONS,
  minPhotos: Number(process.env.IMAGE_WM_MIN_PHOTOS || DEFAULT_MODEL_OPTIONS.minPhotos),
  detect: Number(process.env.IMAGE_WM_DETECT || DEFAULT_MODEL_OPTIONS.detect),
  minMarkedShare: Number(process.env.IMAGE_WM_MIN_MARKED || DEFAULT_MODEL_OPTIONS.minMarkedShare),
  strength: Number(process.env.IMAGE_WM_STRENGTH || DEFAULT_MODEL_OPTIONS.strength),
  coherence: Number(process.env.IMAGE_WM_COHERENCE || DEFAULT_MODEL_OPTIONS.coherence),
};

function log(...a: unknown[]) {
  console.log("[dewm]", ...a);
}

type Photo = {
  file: string;
  donor: ImageDonor;
  width: number;
  height: number;
  rows: ImageRow[];
};

async function dbRows(): Promise<ImageRow[]> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.productImage.findMany({
      select: {
        id: true,
        url: true,
        sourceUrl: true,
        sortOrder: true,
        product: { select: { id: true, nameUk: true, externalSource: true, externalId: true, mergedIntoProductId: true } },
      },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((r) => ({
      imageId: r.id,
      url: r.url,
      sourceUrl: r.sourceUrl,
      sortOrder: r.sortOrder,
      productId: r.product.id,
      productName: r.product.nameUk,
      productSource: r.product.externalSource,
      productExternalId: r.product.externalId,
      mergedIntoProductId: r.product.mergedIntoProductId,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

/** Ім'я файла в MEDIA_ROOT: mirror називає файл sha256(оригінальний URL), аплоади — sha256(вмісту). */
function localName(url: string, sourceUrl: string | null, names: Set<string>): string | null {
  if (url.startsWith("/api/media/")) {
    const n = url.slice("/api/media/".length).split("?")[0] ?? "";
    return names.has(n) ? n : null;
  }
  const key = sourceUrl?.trim() || url;
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "bin"]) {
    if (names.has(`${hash}.${ext}`)) return `${hash}.${ext}`;
  }
  return null;
}

async function readState(): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8")) as { files?: string[] };
    return new Set(parsed.files ?? []);
  } catch {
    return new Set();
  }
}

async function restore(): Promise<void> {
  const done = await readState();
  if (!done.size) {
    log("нема чого повертати: список оброблених порожній");
    return;
  }
  let ok = 0;
  for (const name of done) {
    try {
      await copyFile(path.join(ORIGINALS_ROOT, name), path.join(MEDIA_ROOT, name));
      ok++;
    } catch (e) {
      log(`не вдалося повернути ${name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await writeFile(STATE_FILE, JSON.stringify({ files: [] }, null, 1), "utf8");
  log(`повернуто оригіналів: ${ok} з ${done.size}`);
}

/** Аркуш «до / після» — щоб побачити результат, нічого не переписуючи. */
async function sampleSheet(before: Buffer, after: Buffer, file: string): Promise<void> {
  const meta = await sharp(before).metadata();
  const w = meta.width ?? 500;
  const h = meta.height ?? 500;
  await sharp({ create: { width: w * 2 + 12, height: h, channels: 3, background: "#d0d0d0" } })
    .composite([
      { input: await sharp(before).flatten({ background: "#ffffff" }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp(after).flatten({ background: "#ffffff" }).png().toBuffer(), left: w + 12, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT_DIR, `sample-${file.slice(0, 12)}.jpg`));
}

async function main() {
  if (RESTORE) {
    await restore();
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });

  const rows = MANIFESTS ? await manifestImageRows(path.join(process.cwd(), "data", "scrape")) : await dbRows();
  const names = new Set((await readdir(MEDIA_ROOT)).filter((n) => !n.startsWith(".")));
  const done = await readState();

  // Один файл може стояти в кількох товарів — обробляємо його один раз.
  const byFile = new Map<string, Photo>();
  let unresolved = 0;
  for (const r of rows) {
    const name = localName(r.url, r.sourceUrl, names);
    if (!name) {
      unresolved++;
      continue;
    }
    if (done.has(name)) continue;
    const donor = imageDonor(r.url, r.sourceUrl);
    if (ONLY_DONOR && donor !== ONLY_DONOR) continue;
    const prev = byFile.get(name);
    if (prev) {
      prev.rows.push(r);
      continue;
    }
    byFile.set(name, { file: name, donor, width: 0, height: 0, rows: [r] });
  }
  const photos = [...byFile.values()];
  for (const p of photos) {
    try {
      const m = await sharp(path.join(MEDIA_ROOT, p.file)).metadata();
      p.width = m.width ?? 0;
      p.height = m.height ?? 0;
    } catch {
      p.width = 0;
    }
  }
  const usable = photos.filter((p) => p.width > 0 && p.height > 0);
  log(`джерело=${MANIFESTS ? "manifests" : "db"} рядків=${rows.length} файлів=${usable.length}` +
    `${unresolved ? ` (без локального файла: ${unresolved})` : ""}${done.size ? ` (вже оброблено раніше: ${done.size})` : ""}`);
  log(`MEDIA_ROOT=${MEDIA_ROOT}; резерв оригіналів=${ORIGINALS_ROOT}; режим=${APPLY ? "ЗАПИС" : "перевірка"}; розширення маски=${DILATE}px`);

  // Групи: спершу точний розмір (знак накладено в пікселях), потім нижня смуга для решти
  // (Prom масштабує знак із шириною фото, тож розмірів десятки й точних груп не набрати).
  type Group = { key: string; donor: ImageDonor; geometry: ModelGeometry; photos: Photo[] };
  const groups: Group[] = [];
  const bySize = new Map<string, Photo[]>();
  for (const p of usable) {
    const k = `${p.donor}@${p.width}x${p.height}`;
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k)!.push(p);
  }
  const leftovers = new Map<ImageDonor, Photo[]>();
  for (const [key, list] of [...bySize].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length >= MODEL_OPTIONS.minPhotos) {
      groups.push({ key, donor: list[0].donor, geometry: { kind: "exact", w: list[0].width, h: list[0].height }, photos: list });
    } else {
      if (!leftovers.has(list[0].donor)) leftovers.set(list[0].donor, []);
      leftovers.get(list[0].donor)!.push(...list);
    }
  }
  if (BAND) {
    for (const [donor, list] of leftovers) {
      if (list.length < MODEL_OPTIONS.minPhotos) continue;
      groups.push({
        key: `${donor}@нижня смуга`,
        donor,
        geometry: { kind: "bottom-band", refWidth: BAND_REF_WIDTH, bandHeight: BAND_HEIGHT },
        photos: list,
      });
    }
  }
  log(`груп: ${groups.length} (${groups.map((g) => `${g.key}:${g.photos.length}`).join("  ")})`);
  const skipped = usable.length - groups.reduce((s, g) => s + g.photos.length, 0);
  if (skipped > 0) log(`поза групами (розмір рідкісний, шаблон не побудувати): ${skipped} фото`);

  const report: Record<string, unknown>[] = [];
  let cleaned = 0;
  let samplesWritten = 0;

  for (const g of groups) {
    const w = g.geometry.kind === "exact" ? g.geometry.w : g.geometry.refWidth;
    const h = g.geometry.kind === "exact" ? g.geometry.h : g.geometry.bandHeight;
    // Підпис у донора буває не один: у et-market знайшлося два варіанти логотипа з різним
    // підрядковим текстом і трохи іншим місцем. Один усереднений шаблон описує лише той, що
    // на більшості фото, тож після кожного кола шаблон будуємо заново — вже по тих фото,
    // де знака ще не знайшли, — і так поки черговий шаблон проходить перевірки.
    let rest = g.photos;
    let inGroup = 0;
    for (let round = 1; round <= MAX_ROUNDS && rest.length >= MODEL_OPTIONS.minPhotos; round++) {
      const label = round === 1 ? g.key : `${g.key} коло ${round}`;
      // Полів градієнтів сотні по чверть мільйона чисел — у пам'яті їх не тримаємо,
      // тож група читається трьома проходами: середнє поле, перевірка шаблона, стирання.
      const acc = new WatermarkAccumulator(w, h);
      for (const p of rest) {
        try {
          const f = await modelSpaceGradient(await readFile(path.join(MEDIA_ROOT, p.file)), g.geometry);
          if (f) acc.add(f);
        } catch {
          /* нечитане фото пропускаємо */
        }
      }
      const built = buildWatermarkModel(acc, g.donor, g.geometry, MODEL_OPTIONS);
      if (!built.ok) {
        if (round === 1) report.push({ group: g.key, photos: g.photos.length, skipped: built.reason });
        log(`${label}: N=${built.count} — ${built.reason}`);
        break;
      }
      const model: WatermarkModel = built.model;
      const stats: { zones: ZoneHit[]; control: number }[] = [];
      const productKeys: string[] = [];
      for (const p of rest) {
        try {
          const f = await modelSpaceGradient(await readFile(path.join(MEDIA_ROOT, p.file)), g.geometry);
          if (!f) continue;
          stats.push(zoneStats(model, f, MAX_SHIFT, MODEL_OPTIONS.detect));
          productKeys.push(p.rows[0]?.productId ?? p.file);
        } catch {
          /* нечитане фото пропускаємо */
        }
      }
      // У другому й наступних колах решта — це переважно чисті фото, тож вимагати підпис
      // на половині з них не можна. Решта перевірок (збіг, контроль поза зоною, різні товари)
      // лишається — саме вони й відсіюють «не підпис».
      const opts = round === 1 ? MODEL_OPTIONS : { ...MODEL_OPTIONS, minMarkedShare: MODEL_OPTIONS.minZoneProducts / Math.max(1, stats.length) };
      const check = validateModel(model, stats, opts, productKeys);
      if (!check.ok) {
        if (round === 1) report.push({ group: g.key, photos: g.photos.length, skipped: check.reason });
        log(`${label}: N=${model.count} маска=${((100 * model.maskArea) / (w * h)).toFixed(1)}% — ${check.reason}`);
        break;
      }
      log(
        `${label}: N=${model.count} маска=${((100 * model.maskArea) / (w * h)).toFixed(1)}% зон=${model.zones.length}` +
          `${check.dropped ? ` (відкинуто ${check.dropped} — не підпис)` : ""} ` +
          `[${model.zoneBox.map((b, z) => `x${b.x0}-${b.x1} y${b.y0}-${b.y1} збіг=${check.zoneCosine[z].toFixed(2)}/поза=${check.control[z].toFixed(2)}/товарів=${check.zoneProducts[z]}`).join("; ")}] → знак на ${(100 * model.markedShare).toFixed(0)}% решти`,
      );

      // Карта шаблона — щоб очима перевірити, що знайдено саме підпис.
      const maskPng = Buffer.alloc(w * h);
      for (let i = 0; i < w * h; i++) maskPng[i] = model.mask[i] ? 255 : 0;
      await sharp(maskPng, { raw: { width: w, height: h, channels: 1 } })
        .png()
        .toFile(path.join(OUT_DIR, `mask-${label.replace(/[^\w.-]+/g, "_")}.png`));

      const missed: Photo[] = [];
      let inRound = 0;
      for (const p of rest) {
        if (LIMIT && cleaned >= LIMIT) {
          missed.push(p);
          continue;
        }
        const src = path.join(MEDIA_ROOT, p.file);
        const before = await readFile(src);
        const field = await modelSpaceGradient(before, g.geometry);
        if (!field) continue;
        const zones = zoneStats(model, field, MAX_SHIFT, MODEL_OPTIONS.detect)
          .zones.map((hit, z) => ({ zone: z, dx: hit.dx, dy: hit.dy, r: hit.r }))
          .filter((z) => z.r >= MODEL_OPTIONS.detect);
        if (!zones.length) {
          missed.push(p);
          continue;
        }
        // Без --apply перемальовуємо лише стільки фото, скільки треба на зразки: решту просто рахуємо.
        const needed = APPLY || samplesWritten < SAMPLES;
        const res = needed ? await removeWatermark(before, model, zones, { dilate: DILATE, jpegQuality: JPEG_QUALITY, flatBackground: FLAT_BACKGROUND }) : null;
        if (res && samplesWritten < SAMPLES) {
          await sampleSheet(before, res.buffer, p.file);
          samplesWritten++;
        }
        if (APPLY && res) {
          if (BACKUP) {
            await mkdir(ORIGINALS_ROOT, { recursive: true });
            await copyFile(src, path.join(ORIGINALS_ROOT, p.file));
          }
          await writeFile(src, res.buffer);
          done.add(p.file);
          // Список пишемо по ходу: якщо прогін обірвати, --restore однаково знатиме, що вже змінено.
          if (done.size % 25 === 0) await writeFile(STATE_FILE, JSON.stringify({ files: [...done] }, null, 1), "utf8");
        }
        cleaned++;
        inGroup++;
        inRound++;
        if (inRound % 200 === 0) log(`  ${label}: ${inRound} / ${rest.length}`);
      }
      report.push({
        group: label,
        photos: rest.length,
        modelCount: model.count,
        maskShare: +((100 * model.maskArea) / (w * h)).toFixed(2),
        zones: model.zoneBox,
        zoneCosine: check.zoneCosine.map((v) => +v.toFixed(2)),
        markedShare: +(100 * model.markedShare).toFixed(1),
        cleaned: inRound,
      });
      log(`  ${label}: знак прибрано на ${inRound} фото (лишилось ${missed.length})`);
      if (!inRound) break;
      rest = missed;
    }
    if (inGroup) log(`${g.key}: разом ${inGroup} фото`);
  }

  if (APPLY) await writeFile(STATE_FILE, JSON.stringify({ files: [...done] }, null, 1), "utf8");
  await writeFile(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), apply: APPLY, dilate: DILATE, groups: report }, null, 1),
    "utf8",
  );
  log(`фото зі знаком: ${cleaned}; зразків «до/після»: ${samplesWritten} → ${OUT_DIR}`);
  log(APPLY ? `файли переписано, оригінали в ${ORIGINALS_ROOT} (повернути: npm run img:dewatermark -- --restore)` : "нічого не змінено (додай --apply)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
