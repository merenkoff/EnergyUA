/**
 * Краул каталогу Vsesezon (Prom.ua): групи /ua/g123-slug/, товари з JSON-LD Product.
 *
 *   npx tsx scripts/cli/crawl-vsesezon-catalog.ts --out data/scrape/vsesezon-catalog.json --delay 450
 *   npx tsx scripts/cli/crawl-vsesezon-catalog.ts --out data/scrape/vsesezon-catalog.json --detail --delay 500
 *   npx tsx scripts/cli/crawl-vsesezon-catalog.ts --max-groups 5 --out data/scrape/vsesezon-test.json
 *
 * Імпорт: npm run import:catalog-trees -- --file data/scrape/vsesezon-catalog.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchHtml } from "../parsers/http";
import {
  canonicalVsesezonCategoryUrl,
  discoverVsesezonGroupUrls,
  parseVsesezonJsonLdProducts,
  parseVsesezonNextPageUrl,
  parseVsesezonPageTitle,
} from "../parsers/vsesezonProm";
import type { ScrapeManifest, UnifiedProduct, VsesezonCategoryStat } from "../parsers/types";

const DEFAULT_ORIGIN = "https://vsesezon.com.ua";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function categoryDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function mergePreferDeeperCategory(rows: { p: UnifiedProduct; cat: string }[]): UnifiedProduct[] {
  const byKey = new Map<string, { p: UnifiedProduct; cat: string }>();
  for (const row of rows) {
    const prev = byKey.get(row.p.sourceUrl);
    if (!prev || categoryDepth(row.cat) >= categoryDepth(prev.cat)) {
      byKey.set(row.p.sourceUrl, row);
    }
  }
  return [...byKey.values()].map((x) => ({
    ...x.p,
    sourceCategoryUrl: canonicalVsesezonCategoryUrl(x.cat),
  }));
}

async function writeManifest(manifest: ScrapeManifest, outPath: string) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");
}

async function crawlCategoryAllPages(
  startUrl: string,
  siteOrigin: string,
  delayMs: number,
): Promise<{ products: UnifiedProduct[]; pages: number; title?: string }> {
  const products: UnifiedProduct[] = [];
  let url: string | null = canonicalVsesezonCategoryUrl(startUrl);
  let pages = 0;
  let title: string | undefined;

  while (url && pages < 400) {
    const html = await fetchHtml(url);
    if (pages === 0) title = parseVsesezonPageTitle(html);
    const chunk = parseVsesezonJsonLdProducts(html, siteOrigin, url);
    for (const p of chunk) products.push(p);
    pages++;
    const next = parseVsesezonNextPageUrl(html, url);
    await sleep(delayMs);
    url = next && next !== url ? canonicalVsesezonCategoryUrl(next) : null;
  }

  return { products, pages, title };
}

async function enrichProductDetail(p: UnifiedProduct, siteOrigin: string, delayMs: number): Promise<UnifiedProduct> {
  await sleep(delayMs);
  const html = await fetchHtml(p.sourceUrl);
  const rows = parseVsesezonJsonLdProducts(html, siteOrigin, p.sourceCategoryUrl ?? p.sourceUrl);
  const row = rows.find((r) => r.externalId === p.externalId);
  if (!row) return p;
  return {
    ...p,
    descriptionHtml: row.descriptionHtml && (row.descriptionHtml.length > (p.descriptionHtml?.length ?? 0))
      ? row.descriptionHtml
      : p.descriptionHtml,
    shortDescription: row.shortDescription ?? p.shortDescription,
    images: row.images.length >= p.images.length ? row.images : p.images,
    specs: row.specs.length >= p.specs.length ? row.specs : p.specs,
    sku: p.sku ?? row.sku,
    priceUah: p.priceUah ?? row.priceUah,
    priceVisible: p.priceVisible || row.priceVisible,
  };
}

async function main() {
  const out = arg("--out");
  if (!out) {
    console.error("Потрібно: --out data/scrape/vsesezon-catalog.json");
    process.exit(1);
  }
  const outPath = resolve(out);
  const delayMs = Math.max(0, parseInt(arg("--delay") ?? "450", 10) || 450);
  const origin = (arg("--origin") ?? DEFAULT_ORIGIN).replace(/\/$/, "");
  const maxGroups = parseInt(arg("--max-groups") ?? "0", 10) || 0;
  const detail = hasFlag("--detail");

  const seeds = [`${origin}/ua/`, `${origin}/ua/product_list`];
  console.error(`Збір URL груп (${seeds.join(", ")})…`);
  const groupSet = new Set<string>();
  for (const seed of seeds) {
    const html = await fetchHtml(seed);
    for (const u of discoverVsesezonGroupUrls(html, origin)) {
      groupSet.add(canonicalVsesezonCategoryUrl(u));
    }
    await sleep(delayMs);
  }

  let groupUrls = [...groupSet].sort();
  if (maxGroups > 0) groupUrls = groupUrls.slice(0, maxGroups);

  console.error(`Груп каталогу: ${groupUrls.length}${detail ? " (з деталізацією карток)" : ""}`);

  const flatRows: { p: UnifiedProduct; cat: string }[] = [];
  const perCategory: VsesezonCategoryStat[] = [];

  let gi = 0;
  for (const catUrl of groupUrls) {
    gi++;
    try {
      const { products, pages, title } = await crawlCategoryAllPages(catUrl, origin, delayMs);
      for (const p of products) flatRows.push({ p, cat: catUrl });
      perCategory.push({
        categoryUrl: catUrl,
        title,
        pages,
        productRows: products.length,
      });
      if (gi % 5 === 0) console.error(`… груп ${gi}/${groupUrls.length}, товарів у буфері: ${flatRows.length}`);
    } catch (e) {
      console.error(`Пропуск ${catUrl}:`, e);
    }
  }

  let merged = mergePreferDeeperCategory(flatRows);
  console.error(`Після дедупу за URL: ${merged.length} товарів`);

  if (detail && merged.length) {
    console.error(`Детальні сторінки: ${merged.length} запитів…`);
    const next: UnifiedProduct[] = [];
    let i = 0;
    for (const p of merged) {
      i++;
      try {
        next.push(await enrichProductDetail(p, origin, delayMs));
      } catch (e) {
        console.error(`detail fail ${p.sourceUrl}:`, e);
        next.push(p);
      }
      if (i % 20 === 0) console.error(`… detail ${i}/${merged.length}`);
    }
    merged = next;
  }

  const titleMap = new Map<string, string>();
  for (const row of perCategory) {
    if (row.title) titleMap.set(canonicalVsesezonCategoryUrl(row.categoryUrl), row.title);
  }

  const manifest: ScrapeManifest = {
    scrapedAt: new Date().toISOString(),
    listingUrl: seeds[0],
    products: merged,
    vsesezon: {
      seedUrls: seeds,
      groupUrls,
      perCategory: perCategory,
    },
  };

  await writeManifest(manifest, outPath);
  console.error(`Записано: ${outPath} (${merged.length} товарів)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
