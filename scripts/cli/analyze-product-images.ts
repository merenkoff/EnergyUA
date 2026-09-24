/**
 * Аналіз фото товарів: розмір, різкість, pHash, водяний знак донора, пошук чистої заміни.
 *
 *   npm run img:analyze -- --manifests              # джерело: data/scrape/*.json + storage/media (локально)
 *   npm run img:analyze                             # джерело: БД (DATABASE_URL), фото з MEDIA_ROOT або MEDIA_BASE_URL
 *   npm run img:analyze -- --out out/images.json    # зберегти повний результат для наступних кроків
 *
 * Нічого не змінює — лише читає й друкує звіт.
 *
 * Водяний знак шукаємо без ручних шаблонів: донор накладає той самий знак у тому самому місці
 * на всі свої фото, тому середнє поле градієнтів по сотнях фото гасить різний вміст і лишає
 * контур знака (ідея Dekel et al., CVPR 2017). Далі для кожного фото — нормована кореляція
 * його градієнтів із шаблоном у зоні знака.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTemplate,
  computeFeatures,
  gradientField,
  hammingHex,
  imageDonor,
  groupDuplicateProducts,
  loadImageBytes,
  manifestImageRows,
  watermarkScore,
  type ImageDonor,
  type ImageFeatures,
  type ImageRow,
} from "../lib/imageAnalysis";

const MANIFESTS = process.argv.includes("--manifests");
const OUT = ((): string | null => {
  const i = process.argv.indexOf("--out");
  return i === -1 ? null : process.argv[i + 1] ?? null;
})();
const CONCURRENCY = Math.min(16, Math.max(1, Number(process.env.IMAGE_ANALYSIS_CONCURRENCY || 8)));
/**
 * Поріг кореляції зі шаблоном: вище — знак на фото є. На реальних даних розподіл двогорбий
 * (≈0.0 і ≈0.9); між 0.08 і 0.25 лежить вузька смуга блідих знаків — її і показуємо окремо.
 */
const WM_THRESHOLD = Number(process.env.IMAGE_WATERMARK_THRESHOLD || 0.15);
/** Відстань pHash, за якої вважаємо фото тим самим знімком (0–64). */
const SAME_PHOTO_DISTANCE = Number(process.env.IMAGE_SAME_PHOTO_DISTANCE || 6);
/** Менше фото одного розміру — усереднення не гасить вміст, шаблон не будуємо. */
const MIN_TEMPLATE_PHOTOS = Number(process.env.IMAGE_MIN_TEMPLATE_PHOTOS || 40);
/** Накладений знак збігається з шаблоном майже точно — ось така кореляція вважається «той самий знак». */
const STRONG_MATCH = Number(process.env.IMAGE_STRONG_MATCH || 0.9);
/** Якщо таких фото менше цієї частки, шаблон описує не знак, а спільну композицію фото донора. */
const MIN_STRONG_SHARE = Number(process.env.IMAGE_MIN_STRONG_SHARE || 0.2);

const loadOpts = {
  mediaRoot: process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), "storage", "media"),
  mediaBaseUrl: process.env.MEDIA_BASE_URL?.trim() || undefined,
  userAgent: process.env.MIRROR_IMAGE_USER_AGENT || "ElectroHeatBot/1.0 (+product image mirror)",
  maxBytes: Number(process.env.MIRROR_IMAGE_MAX_BYTES || String(15 * 1024 * 1024)),
};

function log(...a: unknown[]) {
  console.log("[img]", ...a);
}

type Entry = {
  key: string;
  url: string;
  sourceUrl: string | null;
  donor: ImageDonor;
  rows: ImageRow[];
  bytes?: Buffer;
  features?: ImageFeatures;
  error?: string;
  /** Кореляція зі шаблоном знака свого донора (лише для розмірів, де шаблон удалося побудувати). */
  wm?: number;
  hasWatermark: boolean;
  /** Вердикт успадковано від донора: цього розміру фото замало для власного шаблону. */
  inherited: boolean;
  sizeKey?: string;
};

async function pool<T>(items: T[], label: string, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  let done = 0;
  const step = Math.max(1, Math.floor(items.length / 8));
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        await fn(items[next++]);
        if (++done % step === 0) log(`  ${label}: ${done} / ${items.length}`);
      }
    }),
  );
}

function pct(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
}

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

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

async function main() {
  const rows = MANIFESTS ? await manifestImageRows(path.join(process.cwd(), "data", "scrape")) : await dbRows();
  const byKey = new Map<string, Entry>();
  for (const r of rows) {
    const key = r.sourceUrl?.trim() || r.url;
    let e = byKey.get(key);
    if (!e) {
      e = { key, url: r.url, sourceUrl: r.sourceUrl, donor: imageDonor(r.url, r.sourceUrl), rows: [], hasWatermark: false, inherited: false };
      byKey.set(key, e);
    }
    e.rows.push(r);
  }

  const entries = [...byKey.values()];
  log(`джерело=${MANIFESTS ? "manifests" : "db"} рядків=${rows.length} унікальних фото=${entries.length}`);
  log(`MEDIA_ROOT=${loadOpts.mediaRoot}${loadOpts.mediaBaseUrl ? ` MEDIA_BASE_URL=${loadOpts.mediaBaseUrl}` : ""}`);

  // 1. Завантаження + базові ознаки.
  await pool(entries, "читання", async (e) => {
    try {
      e.bytes = await loadImageBytes(e.url, e.sourceUrl, loadOpts);
      e.features = await computeFeatures(e.bytes);
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      e.bytes = undefined;
    }
  });

  log("===== A. Донори =====");
  const donors = [...new Set(entries.map((e) => e.donor))].sort();
  for (const d of donors) {
    const list = entries.filter((e) => e.donor === d);
    const ok = list.filter((e) => e.features);
    const errs = new Map<string, number>();
    for (const e of list) if (e.error) errs.set(e.error, (errs.get(e.error) ?? 0) + 1);
    const sizes = new Map<string, number>();
    for (const e of ok) {
      const k = `${e.features!.width}x${e.features!.height}`;
      sizes.set(k, (sizes.get(k) ?? 0) + 1);
    }
    const sharpness = ok.map((e) => e.features!.sharpness).sort((a, b) => a - b);
    const small = ok.filter((e) => Math.min(e.features!.width, e.features!.height) < 300).length;
    log(`${d}: фото=${list.length} прочитано=${ok.length} помилок=${[...errs].map(([m, c]) => `${m}×${c}`).join(", ") || "0"}`);
    log(`  розміри: ${[...sizes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => `${s}:${c}`).join("  ")}`);
    log(`  < 300px по меншій стороні: ${small} (${fmt((100 * small) / Math.max(1, ok.length), 0)}%); різкість p10/p50/p90: ${fmt(pct(sharpness, 0.1), 0)}/${fmt(pct(sharpness, 0.5), 0)}/${fmt(pct(sharpness, 0.9), 0)}`);
  }

  // 2. Шаблон водяного знака — окремо для кожного розміру: знак накладається в пікселях,
  // тож фото різних розмірів мають його в різних місцях.
  log("===== B. Водяні знаки =====");
  for (const e of entries) if (e.features) e.sizeKey = `${e.donor}@${e.features.width}x${e.features.height}`;

  const bySize = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.bytes || !e.sizeKey) continue;
    if (!bySize.has(e.sizeKey)) bySize.set(e.sizeKey, []);
    bySize.get(e.sizeKey)!.push(e);
  }

  const donorHasWatermark = new Map<ImageDonor, boolean>();
  for (const [sizeKey, list] of [...bySize].sort((a, b) => b[1].length - a[1].length)) {
    const donor = list[0].donor;
    const { width, height } = list[0].features!;
    // Великі фото зменшуємо вдвічі: контур знака лишається, рахунок у 4 рази швидший.
    const scale = Math.max(width, height) >= 400 ? 2 : 1;
    const [w, h] = [Math.round(width / scale), Math.round(height / scale)];
    const t = await buildTemplate(list.map((e) => e.bytes!), w, h, MIN_TEMPLATE_PHOTOS);
    if (!t) continue;
    const share = (100 * t.maskArea) / (t.w * t.h);
    if (!t.valid) {
      log(`${sizeKey}: N=${t.count} маска ${fmt(share, 2)}% → знака немає`);
      donorHasWatermark.set(donor, donorHasWatermark.get(donor) ?? false);
      continue;
    }

    const scored = new Map<Entry, number>();
    for (const e of list) scored.set(e, watermarkScore(t, await gradientField(e.bytes!, t.w, t.h)));
    const scores = [...scored.values()].sort((a, b) => a - b);

    // Однакові за композицією фото (той самий товар у варіаціях) теж лишають стійкий контур
    // після усереднення. Відрізняємо так: накладений знак збігається з шаблоном майже піксель
    // у піксель, тож у донора зі знаком помітна частка фото має кореляцію ≈1; у артефакта —
    // плавний розподіл без такого «горба».
    const strongShare = scores.filter((x) => x >= STRONG_MATCH).length / scores.length;
    if (strongShare < MIN_STRONG_SHARE) {
      log(
        `${sizeKey}: N=${t.count} маска=${fmt(share, 1)}% але лише ${fmt(strongShare * 100, 0)}% фото мають збіг ≥ ${STRONG_MATCH} ` +
          `→ не знак, а схожість самих фото`,
      );
      donorHasWatermark.set(donor, donorHasWatermark.get(donor) ?? false);
      continue;
    }

    for (const [e, sc] of scored) {
      e.wm = sc;
      e.hasWatermark = sc >= WM_THRESHOLD;
    }
    const withWm = list.filter((e) => e.hasWatermark).length;
    if (withWm > 0) donorHasWatermark.set(donor, true);
    const bb = t.bbox!;
    log(
      `${sizeKey}: N=${t.count} маска=${fmt(share, 1)}% зона=x${bb.x0}-${bb.x1} y${bb.y0}-${bb.y1} → ` +
        `зі знаком ${withWm}/${list.length} (${fmt((100 * withWm) / list.length, 0)}%); ` +
        `збіг ≥ ${STRONG_MATCH}: ${fmt(strongShare * 100, 0)}%; score p5/p50/p95 = ${[0.05, 0.5, 0.95].map((p) => fmt(pct(scores, p))).join(" / ")}`,
    );
  }

  // Рідкісні розміри: власного шаблону немає — успадковуємо вердикт донора.
  for (const e of entries) {
    if (!e.bytes || e.wm != null) continue;
    if (donorHasWatermark.get(e.donor)) {
      e.hasWatermark = true;
      e.inherited = true;
    }
  }
  for (const d of donors) {
    const list = entries.filter((e) => e.donor === d && e.bytes);
    const inh = list.filter((e) => e.inherited).length;
    const wm = list.filter((e) => e.hasWatermark).length;
    log(`${d}: разом зі знаком ${wm}/${list.length}${inh ? ` (з них ${inh} — успадковано, розмір рідкісний)` : ""}`);
  }

  // 3. Той самий знімок в іншого донора.
  log("===== C. Те саме фото в іншого донора =====");

  const hashed = entries.filter((e) => e.features?.phash);
  log(`фото з pHash: ${hashed.length} (без хешу — однорідні або нечитані: ${entries.length - hashed.length})`);

  type Match = { from: Entry; to: Entry; d: number };
  const matches: Match[] = [];
  const dirty = hashed.filter((e) => e.hasWatermark);
  const clean = hashed.filter((e) => !e.hasWatermark);
  const bestDistances: number[] = [];
  for (const e of dirty) {
    let best: Entry | undefined;
    let bestD = 65;
    for (const c of clean) {
      if (c === e) continue;
      const d = hammingHex(e.features!.phash!, c.features!.phash!);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best) continue;
    bestDistances.push(bestD);
    if (bestD <= SAME_PHOTO_DISTANCE) matches.push({ from: e, to: best, d: bestD });
  }
  log(`фото зі знаком: ${dirty.length}; чистих фото: ${clean.length}`);
  log(`знайдено чисту заміну (pHash ≤ ${SAME_PHOTO_DISTANCE}): ${matches.length}`);

  const byPair = new Map<string, number>();
  for (const m of matches) {
    const k = `${m.from.donor} → ${m.to.donor}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  for (const [k, c] of [...byPair].sort((a, b) => b[1] - a[1])) log(`  ${k}: ${c}`);

  // Наскільки взагалі близькі чисті фото — видно, чи варто послаблювати поріг.
  const buckets = [0, 2, 4, 6, 8, 10, 14, 20, 64];
  const hist = buckets.slice(0, -1).map((lo, i) => `${lo}-${buckets[i + 1] - 1}: ${bestDistances.filter((d) => d >= lo && d < buckets[i + 1]).length}`);
  log(`  відстань pHash до найближчого чистого фото — ${hist.join("; ")}`);

  // Скільки товарів це реально рятує: фото зі знаком, у яких заміни немає.
  const noReplacement = dirty.filter((e) => !matches.some((m) => m.from === e));
  const productsAffected = new Set(noReplacement.flatMap((e) => e.rows.map((r) => r.productId)));
  log(`фото зі знаком без заміни: ${noReplacement.length} (товарів: ${productsAffected.size})`);

  if (matches.length) {
    log("приклади заміни:");
    for (const m of matches.slice(0, 8)) {
      log(`  d=${m.d} ${m.from.donor} wm=${fmt(m.from.wm ?? NaN)} "${m.from.rows[0].productName.slice(0, 44)}" → ${m.to.donor} wm=${fmt(m.to.wm ?? NaN)} ${m.to.features!.width}x${m.to.features!.height}`);
    }
  }

  // 4. Фото того самого товару в донора без знаків — головний шлях заміни.
  log("===== D. Чисте фото того самого товару =====");
  const productMeta = new Map<string, { productId: string; name: string; source: string | null; merged: string | null }>();
  for (const r of rows) {
    if (!productMeta.has(r.productId)) {
      productMeta.set(r.productId, { productId: r.productId, name: r.productName, source: r.productSource, merged: r.mergedIntoProductId });
    }
  }
  const products = [...productMeta.values()];
  // У БД злиття вже пораховане імпортом; для манифестів відтворюємо ту саму логіку.
  const hasMergeInfo = products.some((p) => p.merged);
  const groupOf = hasMergeInfo
    ? new Map(products.map((p) => [p.productId, p.merged ?? p.productId]))
    : groupDuplicateProducts(products);

  const photosOfProduct = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const r of e.rows) {
      if (!photosOfProduct.has(r.productId)) photosOfProduct.set(r.productId, []);
      if (!photosOfProduct.get(r.productId)!.includes(e)) photosOfProduct.get(r.productId)!.push(e);
    }
  }
  const membersOfGroup = new Map<string, string[]>();
  for (const [pid, gid] of groupOf) {
    if (!membersOfGroup.has(gid)) membersOfGroup.set(gid, []);
    membersOfGroup.get(gid)!.push(pid);
  }
  log(`товарів=${products.length}; груп-дублікатів (>1 товар)=${[...membersOfGroup.values()].filter((m) => m.length > 1).length}` +
      ` (злиття ${hasMergeInfo ? "з БД" : "пораховано за назвами"})`);

  let allClean = 0;
  let mixed = 0;
  let coverDirty = 0;
  let allDirty = 0;
  let rescuable = 0;
  const rescueExamples: string[] = [];
  const bySource = new Map<string, { total: number; allDirty: number; mixed: number }>();
  for (const p of products) {
    const own = (photosOfProduct.get(p.productId) ?? []).filter((e) => e.features);
    if (!own.length) continue;
    const key = p.source ?? "—";
    if (!bySource.has(key)) bySource.set(key, { total: 0, allDirty: 0, mixed: 0 });
    const agg = bySource.get(key)!;
    agg.total++;

    const clean = own.filter((e) => !e.hasWatermark);
    const dirty = own.filter((e) => e.hasWatermark);
    // Обкладинка — фото з найменшим sortOrder.
    const cover = own.slice().sort((a, b) => Math.min(...a.rows.map((r) => r.sortOrder)) - Math.min(...b.rows.map((r) => r.sortOrder)))[0];
    if (cover.hasWatermark) coverDirty++;

    if (!dirty.length) {
      allClean++;
      continue;
    }
    if (clean.length) {
      mixed++;
      agg.mixed++;
      continue;
    }
    allDirty++;
    agg.allDirty++;
    const siblings = (membersOfGroup.get(groupOf.get(p.productId)!) ?? []).filter((id) => id !== p.productId);
    const cleanPhoto = siblings.flatMap((id) => photosOfProduct.get(id) ?? []).find((e) => !e.hasWatermark && e.features);
    if (cleanPhoto) {
      rescuable++;
      if (rescueExamples.length < 6) {
        rescueExamples.push(`  "${p.name.slice(0, 46)}" (${p.source}) ← ${cleanPhoto.donor} ${cleanPhoto.features!.width}x${cleanPhoto.features!.height}`);
      }
    }
  }
  log(`усі фото чисті: ${allClean}`);
  log(`є і чисті, і зі знаком → досить поставити чисте обкладинкою: ${mixed}`);
  log(`усі фото зі знаком: ${allDirty}; з них рятує фото дубліката: ${rescuable}`);
  log(`обкладинка зараз зі знаком: ${coverDirty} з ${allClean + mixed + allDirty}`);
  for (const [src, a] of [...bySource].sort((x, y) => y[1].total - x[1].total)) {
    log(`  ${src}: товарів=${a.total} усі фото зі знаком=${a.allDirty} змішані=${a.mixed}`);
  }
  for (const line of rescueExamples) log(line);

  if (OUT) {
    const payload = {
      generatedAt: new Date().toISOString(),
      source: MANIFESTS ? "manifests" : "db",
      watermarkThreshold: WM_THRESHOLD,
      samePhotoDistance: SAME_PHOTO_DISTANCE,
      images: entries.map((e) => ({
        key: e.key,
        url: e.url,
        sourceUrl: e.sourceUrl,
        donor: e.donor,
        error: e.error ?? null,
        width: e.features?.width ?? null,
        height: e.features?.height ?? null,
        format: e.features?.format ?? null,
        sharpness: e.features ? +e.features.sharpness.toFixed(1) : null,
        phash: e.features?.phash ?? null,
        watermark: e.wm != null ? +e.wm.toFixed(4) : null,
        hasWatermark: e.hasWatermark,
        watermarkInherited: e.inherited,
        imageIds: e.rows.map((r) => r.imageId),
        productIds: [...new Set(e.rows.map((r) => r.productId))],
      })),
      replacements: matches.map((m) => ({ from: m.from.key, to: m.to.key, distance: m.d })),
    };
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(payload, null, 1), "utf8");
    log(`результат збережено: ${OUT}`);
  }

  log("готово");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
