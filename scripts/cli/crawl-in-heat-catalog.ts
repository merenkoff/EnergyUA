/**
 * Обхід каталогу IN-HEAT з меню на https://in-heat.kiev.ua/ua/ (усі гілки: otoplenie, termoregulyatory,
 * sistema-antiobledeneniya, electrotovary, tovary). Товари з різних URL зводяться в один manifest; дублікати за
 * sourceUrl віддають глибшу категорію. Імпорт: npm run import:catalog-trees.
 *
 * Лише списки:
 *   npx tsx scripts/cli/crawl-in-heat-catalog.ts --listing-only --out data/scrape/in-heat-catalog-FULL.json --delay 400
 *
 * Усі картки:
 *   npx tsx scripts/cli/crawl-in-heat-catalog.ts --detail-all --out data/scrape/in-heat-catalog-DETAIL.json --delay 450
 *
 * Продовжити:
 *   cp data/scrape/in-heat-catalog-FULL.json data/scrape/in-heat-catalog-DETAIL.json
 *   npx tsx scripts/cli/crawl-in-heat-catalog.ts --detail-from data/scrape/in-heat-catalog-DETAIL.json --out data/scrape/in-heat-catalog-DETAIL.json --detail-all --checkpoint-every 25 --delay 450
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchHtml } from "../parsers/http";
import { unifiedProductAsListingStub } from "../lib/manifestListing";
import {
  IN_HEAT_DEFAULT_CATALOG_PREFIXES,
  discoverInHeatCategoryUrls,
  inHeatCategoryListingUrl,
  parseInHeatCategoryHeading,
  parseInHeatCategoryListing,
  parseInHeatCategoryMaxPage,
  parseInHeatProductPage,
} from "../parsers/inHeat";
import type { InHeatCategoryStat, ScrapeManifest, UnifiedListingItem, UnifiedProduct } from "../parsers/types";

const DEFAULT_BASE = "https://in-heat.kiev.ua";
const DEFAULT_SEED = `${DEFAULT_BASE}/ua/`;

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

async function writeManifestFile(manifest: ScrapeManifest, outPath: string) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");
}

function canonicalCategoryUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("PAGEN_1");
  const parts = u.pathname.split("/").filter(Boolean);
  u.pathname = "/" + parts.join("/") + "/";
  return u.toString();
}

function inHeatPathDepth(categoryUrl: string): number {
  try {
    return new URL(categoryUrl).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function mergeInHeatListingPreferDeeperCategory(
  rows: { item: UnifiedListingItem; categoryUrl: string }[],
): UnifiedListingItem[] {
  const byUrl = new Map<string, { item: UnifiedListingItem; categoryUrl: string }>();
  for (const row of rows) {
    const prev = byUrl.get(row.item.sourceUrl);
    if (!prev || inHeatPathDepth(row.categoryUrl) >= inHeatPathDepth(prev.categoryUrl)) {
      byUrl.set(row.item.sourceUrl, row);
    }
  }
  return [...byUrl.values()].map((x) => ({
    ...x.item,
    sourceCategoryUrl: canonicalCategoryUrl(x.categoryUrl),
  }));
}

async function listingAllPages(
  categoryUrl: string,
  base: string,
  delayMs: number,
): Promise<{ items: UnifiedListingItem[]; pages: number; title?: string }> {
  const cat = canonicalCategoryUrl(categoryUrl);
  const html1 = await fetchHtml(cat);
  const title = parseInHeatCategoryHeading(html1);
  const maxPage = parseInHeatCategoryMaxPage(html1);
  const seen = new Set<string>();
  const items: UnifiedListingItem[] = [];

  for (let p = 1; p <= maxPage; p++) {
    const pageUrl = inHeatCategoryListingUrl(cat, p, base);
    const html = p === 1 ? html1 : await fetchHtml(pageUrl);
    const rows = parseInHeatCategoryListing(html, base, cat);
    for (const row of rows) {
      if (seen.has(row.sourceUrl)) continue;
      seen.add(row.sourceUrl);
      items.push(row);
    }
    if (delayMs > 0 && p < maxPage) await sleep(delayMs);
  }

  return { items, pages: maxPage, title };
}

async function readExtraUrls(path: string): Promise<string[]> {
  const raw = await readFile(resolve(path), "utf-8");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function main() {
  const seed = arg("--seed") || DEFAULT_SEED;
  const outPath = resolve(arg("--out") || "data/scrape/in-heat-catalog.json");
  const prefixArg = arg("--prefix") ?? IN_HEAT_DEFAULT_CATALOG_PREFIXES.join(",");
  const pathPrefixes = prefixArg.split(",").map((s) => s.trim()).filter(Boolean);
  const delayMs = arg("--delay") ? parseInt(arg("--delay")!, 10) : 400;
  const listingOnly = hasFlag("--listing-only");
  const detailAll = hasFlag("--detail-all");
  const detailFromPath = arg("--detail-from");
  const detailStart = arg("--detail-start") ? parseInt(arg("--detail-start")!, 10) : 0;
  const detailEndRaw = arg("--detail-end");
  const detailLimit = arg("--detail-limit") ? parseInt(arg("--detail-limit")!, 10) : 0;
  const checkpointEvery = arg("--checkpoint-every") ? parseInt(arg("--checkpoint-every")!, 10) : 0;
  const extraFile = arg("--extra-urls");
  const maxCategories = arg("--max-categories") ? parseInt(arg("--max-categories")!, 10) : 0;

  if (listingOnly && (detailAll || detailLimit > 0 || detailStart > 0 || detailEndRaw !== undefined)) {
    console.error("Несумісно: --listing-only разом із допарсом карток.");
    process.exit(1);
  }

  let manifest: ScrapeManifest;
  let mergedListing: UnifiedListingItem[];
  let categoryUrls: string[] = [];
  let perCategory: InHeatCategoryStat[] = [];

  if (detailFromPath) {
    const raw = JSON.parse(await readFile(resolve(detailFromPath), "utf-8")) as ScrapeManifest;
    manifest = raw;
    if (!manifest.products?.length) {
      console.error("--detail-from: порожній products.");
      process.exit(1);
    }
    if (!manifest.inHeat) {
      console.error("У файлі немає inHeat (очікується manifest з parse:in-heat-catalog).");
      process.exit(1);
    }
    mergedListing = manifest.products.map((p) => unifiedProductAsListingStub(p as UnifiedProduct));
    categoryUrls = manifest.inHeat.categoryUrls;
    perCategory = manifest.inHeat.perCategory;
    console.error(`Завантажено ${mergedListing.length} позицій з ${detailFromPath}`);
  } else {
    const seedHtml = await fetchHtml(seed);
    categoryUrls = discoverInHeatCategoryUrls(seedHtml, pathPrefixes, DEFAULT_BASE);

    if (extraFile) {
      const extra = await readExtraUrls(extraFile);
      const set = new Set(categoryUrls);
      for (const u of extra) {
        const abs = u.startsWith("http") ? u : new URL(u, DEFAULT_BASE).toString();
        set.add(canonicalCategoryUrl(abs));
      }
      categoryUrls = [...set].sort();
    }

    if (maxCategories > 0) {
      categoryUrls = categoryUrls.slice(0, maxCategories);
    }

    const pairRows: { item: UnifiedListingItem; categoryUrl: string }[] = [];
    perCategory = [];

    for (const catUrl of categoryUrls) {
      const cat = canonicalCategoryUrl(catUrl);
      const { items, pages, title } = await listingAllPages(cat, DEFAULT_BASE, delayMs);
      perCategory.push({
        categoryUrl: cat,
        title,
        pages,
        listingRows: items.length,
      });
      for (const row of items) {
        pairRows.push({ item: row, categoryUrl: cat });
      }
      if (delayMs > 0) await sleep(delayMs);
    }

    mergedListing = mergeInHeatListingPreferDeeperCategory(pairRows);

    const stubs: UnifiedProduct[] = mergedListing.map((l) => ({
      ...l,
      images: l.imageUrl ? [{ url: l.imageUrl, alt: l.nameUk }] : [],
      specs: [],
    }));

    manifest = {
      scrapedAt: new Date().toISOString(),
      listingUrl: seed,
      products: stubs,
      inHeat: {
        seedUrl: seed,
        pathPrefixes,
        categoryUrls,
        perCategory,
      },
    };
  }

  const wantDetail =
    !listingOnly &&
    (detailAll || detailLimit > 0 || detailStart > 0 || detailEndRaw !== undefined);

  if (wantDetail) {
    let endExclusive = mergedListing.length;
    if (detailEndRaw !== undefined) {
      endExclusive = Math.min(parseInt(detailEndRaw, 10), mergedListing.length);
    } else if (!detailAll && detailLimit > 0) {
      endExclusive = Math.min(detailStart + detailLimit, mergedListing.length);
    }

    if (detailStart < 0 || detailStart >= mergedListing.length) {
      console.error(`--detail-start поза діапазоном [0, ${mergedListing.length})`);
      process.exit(1);
    }
    if (endExclusive <= detailStart) {
      console.error("Невірний діапазон detail-end / detail-start.");
      process.exit(1);
    }

    console.error(
      `Допарс карток: індекси ${detailStart} … ${endExclusive - 1} (${endExclusive - detailStart} шт.)`,
    );

    for (let i = detailStart; i < endExclusive; i++) {
      const item = mergedListing[i];
      const pHtml = await fetchHtml(item.sourceUrl);
      manifest.products[i] = parseInHeatProductPage(pHtml, DEFAULT_BASE, item);
      if (delayMs > 0) await sleep(delayMs);

      if (checkpointEvery > 0 && (i - detailStart + 1) % checkpointEvery === 0) {
        manifest.scrapedAt = new Date().toISOString();
        await writeManifestFile(manifest, outPath);
        console.error(`checkpoint: ${outPath} (індекс ${i})`);
      }
    }
  }

  manifest.scrapedAt = new Date().toISOString();
  await writeManifestFile(manifest, outPath);

  const detailedCount = manifest.products.filter(
    (p) => (p as UnifiedProduct).descriptionHtml || (p as UnifiedProduct).specs?.length,
  ).length;

  console.error(
    `OK: категорій ${categoryUrls.length}, товарів ${manifest.products.length}, з описом/спеками ≈${detailedCount} → ${outPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
