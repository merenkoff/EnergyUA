/**
 * Аналіз фото товарів: розмір, різкість, pHash, оцінка водяного знака донора.
 *
 *   npx tsx scripts/cli/analyze-product-images.ts --report   # лише діагностика в stdout, БД не змінюється
 *
 * Файли /api/media/… читаються з MEDIA_ROOT; якщо їх там немає (запуск поза контейнером із volume) —
 * з MEDIA_BASE_URL (публічний домен сайту). Зовнішні URL качаються напряму.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  WatermarkEstimator,
  asciiMap,
  computeFeatures,
  gradientField,
  hammingHex,
  imageDonor,
  loadImageBytes,
  watermarkScore,
  type ImageDonor,
  type ImageFeatures,
  type WatermarkTemplate,
} from "../lib/imageAnalysis";

const prisma = new PrismaClient();

const REPORT = process.argv.includes("--report");
const CONCURRENCY = Math.min(16, Math.max(1, Number(process.env.IMAGE_ANALYSIS_CONCURRENCY || 8)));
const MIN_BUCKET = Number(process.env.IMAGE_ANALYSIS_MIN_BUCKET || 40);
const DONORS_WITH_WATERMARK: ImageDonor[] = ["et_market", "in_heat", "vsesezon"];

const loadOpts = {
  mediaRoot: process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), "storage", "media"),
  mediaBaseUrl: process.env.MEDIA_BASE_URL?.trim() || undefined,
  userAgent: process.env.MIRROR_IMAGE_USER_AGENT || "ElectroHeatBot/1.0 (+product image mirror)",
  maxBytes: Number(process.env.MIRROR_IMAGE_MAX_BYTES || String(15 * 1024 * 1024)),
};

function log(...a: unknown[]) {
  console.log("[img]", ...a);
}

type Row = {
  id: string;
  url: string;
  sourceUrl: string | null;
  sortOrder: number;
  product: { id: string; nameUk: string; externalSource: string | null; mergedIntoProductId: string | null; published: boolean };
};

type Entry = {
  url: string;
  sourceUrl: string | null;
  donor: ImageDonor;
  rows: Row[];
  bytes?: Buffer;
  features?: ImageFeatures;
  error?: string;
  bucket?: string;
  score?: number;
  normScore?: number;
};

async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  let done = 0;
  const step = Math.max(1, Math.floor(items.length / 10));
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
        if (++done % step === 0) log(`… ${done} / ${items.length}`);
      }
    }),
  );
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function fmt(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function histogram(values: number[], lo: number, hi: number, step: number): string[] {
  const bins = Math.round((hi - lo) / step);
  const counts = new Array(bins + 2).fill(0);
  for (const v of values) {
    if (v < lo) counts[0]++;
    else if (v >= hi) counts[bins + 1]++;
    else counts[1 + Math.floor((v - lo) / step)]++;
  }
  const max = Math.max(1, ...counts);
  const lines: string[] = [];
  counts.forEach((c, i) => {
    if (!c) return;
    const label = i === 0 ? `<${fmt(lo)}` : i === bins + 1 ? `>=${fmt(hi)}` : `${fmt(lo + (i - 1) * step)}..${fmt(lo + i * step)}`;
    lines.push(`${label.padStart(12)} ${String(c).padStart(5)} ${"#".repeat(Math.ceil((c / max) * 50))}`);
  });
  return lines;
}

/** Робочий розмір для шаблону: великі фото зменшуємо вдвічі (контури знака лишаються, рахунок у 4 рази швидший). */
function workSize(w: number, h: number): [number, number] {
  return w >= 400 || h >= 400 ? [Math.round(w / 2), Math.round(h / 2)] : [w, h];
}

async function main() {
  const rows: Row[] = await prisma.productImage.findMany({
    select: {
      id: true,
      url: true,
      sourceUrl: true,
      sortOrder: true,
      product: { select: { id: true, nameUk: true, externalSource: true, mergedIntoProductId: true, published: true } },
    },
  });

  const byUrl = new Map<string, Entry>();
  for (const r of rows) {
    let e = byUrl.get(r.url);
    if (!e) {
      e = { url: r.url, sourceUrl: r.sourceUrl, donor: imageDonor(r.url, r.sourceUrl), rows: [] };
      byUrl.set(r.url, e);
    }
    e.rows.push(r);
  }
  const entries = [...byUrl.values()];
  log(`mode=${REPORT ? "report" : "?"} rows=${rows.length} unique=${entries.length} MEDIA_ROOT=${loadOpts.mediaRoot} MEDIA_BASE_URL=${loadOpts.mediaBaseUrl ?? "—"}`);

  // Прохід 1: завантаження + базові ознаки (байти тримаємо в пам'яті для наступних проходів).
  await pool(entries, async (e) => {
    try {
      e.bytes = await loadImageBytes(e.url, loadOpts);
      e.features = await computeFeatures(e.bytes);
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      e.bytes = undefined;
    }
  });

  // ---- A. Огляд по донорах ----
  log("===== A. Донори =====");
  const donors = [...new Set(entries.map((e) => e.donor))];
  for (const d of donors) {
    const list = entries.filter((e) => e.donor === d);
    const ok = list.filter((e) => e.features);
    const errs = new Map<string, number>();
    for (const e of list) if (e.error) errs.set(e.error, (errs.get(e.error) ?? 0) + 1);
    const local = list.filter((e) => e.url.startsWith("/api/media/")).length;
    log(`${d}: unique=${list.length} ok=${ok.length} local=${local} errors=${[...errs].map(([m, c]) => `${m}×${c}`).join(", ") || "0"}`);
    const sizes = new Map<string, number>();
    for (const e of ok) sizes.set(`${e.features!.width}x${e.features!.height}`, (sizes.get(`${e.features!.width}x${e.features!.height}`) ?? 0) + 1);
    log(`  розміри: ${[...sizes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, c]) => `${s}:${c}`).join("  ")}`);
    const sharp = ok.map((e) => e.features!.sharpness).sort((a, b) => a - b);
    const minSide = ok.map((e) => Math.min(e.features!.width, e.features!.height));
    log(`  різкість p10/p50/p90: ${fmt(pct(sharp, 0.1), 0)}/${fmt(pct(sharp, 0.5), 0)}/${fmt(pct(sharp, 0.9), 0)}; мін. сторона <300px: ${minSide.filter((s) => s < 300).length}; формати: ${[...new Set(ok.map((e) => e.features!.format))].join(",")}`);
  }

  // ---- B. Шаблони водяних знаків ----
  log("===== B. Водяні знаки =====");
  const buckets = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!e.features || !DONORS_WITH_WATERMARK.includes(e.donor)) continue;
    const key = `${e.donor}@${e.features.width}x${e.features.height}`;
    e.bucket = key;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }
  const templates = new Map<string, WatermarkTemplate>();
  for (const [key, list] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < MIN_BUCKET) continue;
    const [w, h] = workSize(list[0].features!.width, list[0].features!.height);
    const est = new WatermarkEstimator(w, h);
    for (const e of list) est.add(await gradientField(e.bytes!, w, h));
    templates.set(key, est.build());
  }
  // Додатково: усі фото донора, приведені до 200×200 (якщо знак масштабується разом із фото).
  for (const d of DONORS_WITH_WATERMARK) {
    const list = entries.filter((e) => e.donor === d && e.features);
    if (list.length < MIN_BUCKET) continue;
    const est = new WatermarkEstimator(200, 200);
    for (const e of list) est.add(await gradientField(e.bytes!, 200, 200));
    templates.set(`${d}@norm200`, est.build());
  }

  for (const [key, t] of templates) {
    const isNorm = key.endsWith("@norm200");
    const list = isNorm ? entries.filter((e) => e.features && `${e.donor}@norm200` === key) : buckets.get(key)!;
    const scores: number[] = [];
    for (const e of list) {
      const s = watermarkScore(t, await gradientField(e.bytes!, t.w, t.h));
      if (isNorm) e.normScore = s;
      else e.score = s;
      scores.push(s);
    }
    scores.sort((a, b) => a - b);
    const bb = t.bbox;
    log(
      `--- ${key}: N=${t.count} work=${t.w}x${t.h} noise=${fmt(t.noiseMedian)} cut=${fmt(t.cut)} p99.9=${fmt(t.p999)} ` +
        `mask=${t.maskArea}px (${fmt((100 * t.maskArea) / (t.w * t.h), 1)}%) bbox=${bb ? `x${bb.x0}-${bb.x1} y${bb.y0}-${bb.y1}` : "—"}`,
    );
    for (const line of asciiMap(t.strength, t.w, t.h, 100, 40)) log(`|${line}|`);
    log(`  score p5/p25/p50/p75/p95: ${[0.05, 0.25, 0.5, 0.75, 0.95].map((p) => fmt(pct(scores, p))).join(" / ")}`);
    for (const line of histogram(scores, -0.1, 0.9, 0.05)) log(`  ${line}`);
  }

  // ---- C. pHash: заглушки, дублікати між донорами ----
  log("===== C. pHash =====");
  const hashed = entries.filter((e) => e.features?.phash);
  log(`з хешем: ${hashed.length}, без хешу (однорідні/помилки): ${entries.length - hashed.length}`);
  const byHash = new Map<string, Entry[]>();
  for (const e of hashed) {
    const h = e.features!.phash!;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h)!.push(e);
  }
  const common = [...byHash]
    .map(([h, list]) => ({ h, list, products: new Set(list.flatMap((e) => e.rows.map((r) => r.product.id))).size }))
    .filter((x) => x.products >= 5)
    .sort((a, b) => b.products - a.products)
    .slice(0, 10);
  for (const c of common) {
    log(`  спільний хеш ${c.h}: товарів=${c.products} файлів=${c.list.length} напр.: ${c.list[0].rows[0].product.nameUk.slice(0, 60)} | ${c.list[0].sourceUrl ?? c.list[0].url}`);
  }

  // Групи злиття: канонічний товар + дублікати з інших джерел.
  const productImages = new Map<string, { entry: Entry; row: Row }[]>();
  const productInfo = new Map<string, Row["product"]>();
  for (const e of entries) {
    for (const r of e.rows) {
      if (!productImages.has(r.product.id)) productImages.set(r.product.id, []);
      productImages.get(r.product.id)!.push({ entry: e, row: r });
      productInfo.set(r.product.id, r.product);
    }
  }
  const groups = new Map<string, string[]>();
  for (const [pid, p] of productInfo) {
    const canon = p.mergedIntoProductId ?? pid;
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon)!.push(pid);
  }
  const multi = [...groups].filter(([, members]) => members.length > 1);
  log(`груп злиття з >1 товаром: ${multi.length}`);

  const groupDists: number[] = [];
  const examples: { d: number; a: string; b: string; sa?: number; sb?: number }[] = [];
  for (const [canon, members] of multi) {
    const canonImgs = (productImages.get(canon) ?? []).filter((x) => x.entry.features?.phash);
    const others = members.filter((m) => m !== canon).flatMap((m) => (productImages.get(m) ?? []).filter((x) => x.entry.features?.phash));
    if (!canonImgs.length || !others.length) continue;
    for (const ci of canonImgs) {
      let best = 65;
      let bestO: (typeof others)[number] | undefined;
      for (const o of others) {
        const d = hammingHex(ci.entry.features!.phash!, o.entry.features!.phash!);
        if (d < best) {
          best = d;
          bestO = o;
        }
      }
      groupDists.push(best);
      if (bestO) {
        examples.push({
          d: best,
          a: `${ci.entry.donor} "${ci.row.product.nameUk.slice(0, 50)}"`,
          b: `${bestO.entry.donor} "${bestO.row.product.nameUk.slice(0, 50)}"`,
          sa: ci.entry.score,
          sb: bestO.entry.score,
        });
      }
    }
  }
  log(`найближче фото дубліката з іншого донора для фото канонічних товарів (${groupDists.length}):`);
  for (const line of histogram(groupDists, 0, 32, 2)) log(`  ${line}`);

  // Глобально: для кожного фото — найближче фото іншого донора.
  const globalDists: number[] = [];
  const globalEx: typeof examples = [];
  for (const e of hashed) {
    let best = 65;
    let bestO: Entry | undefined;
    for (const o of hashed) {
      if (o.donor === e.donor) continue;
      const d = hammingHex(e.features!.phash!, o.features!.phash!);
      if (d < best) {
        best = d;
        bestO = o;
      }
    }
    if (!bestO) continue;
    globalDists.push(best);
    globalEx.push({ d: best, a: `${e.donor} "${e.rows[0].product.nameUk.slice(0, 50)}"`, b: `${bestO.donor} "${bestO.rows[0].product.nameUk.slice(0, 50)}"`, sa: e.score, sb: bestO.score });
  }
  log(`глобально: найближче фото іншого донора (${globalDists.length}):`);
  for (const line of histogram(globalDists, 0, 32, 2)) log(`  ${line}`);

  for (const [label, list] of [["групи", examples], ["глобально", globalEx]] as const) {
    for (const [lo, hi] of [[0, 2], [3, 6], [7, 10], [11, 14], [15, 20]]) {
      const sel = list.filter((x) => x.d >= lo && x.d <= hi).slice(0, 6);
      for (const x of sel) log(`  приклад ${label} d=${x.d}: ${x.a} [wm ${fmt(x.sa ?? NaN)}] ↔ ${x.b} [wm ${fmt(x.sb ?? NaN)}]`);
    }
  }

  log("готово");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
