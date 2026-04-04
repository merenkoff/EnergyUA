/**
 * Повний обхід каталогу et-market.com.ua: хаби + підрозділи, усі сторінки ?page=,
 * дедуплікат товарів, опційно повні картки (опис, галерея, характеристики).
 *
 * Лише списки:
 *   npx tsx scripts/cli/crawl-et-market-catalog.ts --listing-only --out data/scrape/et-catalog-FULL.json --delay 200
 *
 * Усі картки (тисячі запитів, ~45 хв при delay 450):
 *   npx tsx scripts/cli/crawl-et-market-catalog.ts --detail-all --out data/scrape/et-catalog-DETAIL.json --delay 450
 *
 * Продовжити з listing JSON (спочатку скопіюйте файл):
 *   cp data/scrape/et-catalog-FULL.json data/scrape/et-catalog-DETAIL.json
 *   npx tsx scripts/cli/crawl-et-market-catalog.ts --detail-from data/scrape/et-catalog-DETAIL.json --out data/scrape/et-catalog-DETAIL.json --detail-all --checkpoint-every 50 --delay 450
 *
 * Частинами (індекси як у масиві products після listing):
 *   ... --detail-start 0 --detail-end 500 --out chunk-a.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchHtml } from "../parsers/http";
import { unifiedProductAsListingStub } from "../lib/manifestListing";
import {
  ET_MARKET_CATALOG_ROOTS,
  discoverEtMarketCategoryUrls,
  etMarketCategoryPageUrl,
  mergeEtListingPreferDeeperCategory,
  normalizeEtCategoryUrl,
  parseEtMarketCategoryHeading,
  parseEtMarketCategoryListing,
  parseEtMarketPagination,
  parseEtMarketProductPage,
} from "../parsers/etMarket";
import type {
  EtMarketCategoryDiscoverRow,
  ScrapeManifest,
  UnifiedListingItem,
  UnifiedProduct,
} from "../parsers/types";

const DEFAULT_BASE = "https://et-market.com.ua";

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

async function discoverAllCategoryUrls(delayMs: number): Promise<string[]> {
  const found = new Set<string>();
  const pathsToFetch = ["", ...[...ET_MARKET_CATALOG_ROOTS].map((r) => `/${r}/`)];

  for (let i = 0; i < pathsToFetch.length; i++) {
    const path = pathsToFetch[i];
    const url = new URL(path || "/", DEFAULT_BASE).toString();
    const html = await fetchHtml(url);
    for (const u of discoverEtMarketCategoryUrls(html, DEFAULT_BASE)) {
      found.add(u);
    }
    if (delayMs > 0 && i < pathsToFetch.length - 1) await sleep(delayMs);
  }

  return [...found].sort();
}

async function main() {
  const outPath = resolve(arg("--out") || "data/scrape/et-catalog-full.json");
  const delayMs = arg("--delay") ? parseInt(arg("--delay")!, 10) : 200;
  const listingOnly = hasFlag("--listing-only");
  const detailAll = hasFlag("--detail-all");
  const detailFromPath = arg("--detail-from");
  const detailStart = arg("--detail-start") ? parseInt(arg("--detail-start")!, 10) : 0;
  const detailEndRaw = arg("--detail-end");
  const detailLimit = arg("--detail-limit") ? parseInt(arg("--detail-limit")!, 10) : 0;
  const checkpointEvery = arg("--checkpoint-every") ? parseInt(arg("--checkpoint-every")!, 10) : 0;
  const maxCategories = arg("--max-categories") ? parseInt(arg("--max-categories")!, 10) : 0;

  if (listingOnly && (detailAll || detailLimit > 0 || detailStart > 0 || detailEndRaw !== undefined)) {
    console.error("Несумісно: --listing-only разом із допарсом карток.");
    process.exit(1);
  }

  const seedUrls = [DEFAULT_BASE + "/", ...[...ET_MARKET_CATALOG_ROOTS].map((r) => `${DEFAULT_BASE}/${r}/`)];

  let manifest: ScrapeManifest;
  let mergedListing: UnifiedListingItem[];
  let categoryUrls: string[] = [];
  let perCategory: EtMarketCategoryDiscoverRow[] = [];

  if (detailFromPath) {
    const raw = JSON.parse(await readFile(resolve(detailFromPath), "utf-8")) as ScrapeManifest;
    manifest = raw;
    if (!manifest.products?.length) {
      console.error("--detail-from: порожній або відсутній масив products.");
      process.exit(1);
    }
    if (!manifest.etMarketCrawl) {
      console.error("У файлі немає etMarketCrawl (очікується manifest з parse:et-catalog).");
      process.exit(1);
    }
    mergedListing = manifest.products.map((p) => unifiedProductAsListingStub(p as UnifiedProduct));
    categoryUrls = manifest.etMarketCrawl.categoryUrls;
    perCategory = manifest.etMarketCrawl.perCategory;
    console.error(
      `Завантажено ${mergedListing.length} позицій з ${detailFromPath} — допарс карток з індексу ${detailStart}`,
    );
  } else {
    let discovered = await discoverAllCategoryUrls(delayMs);
    if (maxCategories > 0) {
      discovered = discovered.slice(0, maxCategories);
    }
    categoryUrls = discovered;

    const pairRows: { item: UnifiedListingItem; categoryUrl: string }[] = [];
    perCategory = [];

    for (let i = 0; i < categoryUrls.length; i++) {
      const canon = normalizeEtCategoryUrl(categoryUrls[i], DEFAULT_BASE);
      const html1 = await fetchHtml(etMarketCategoryPageUrl(canon, 1, DEFAULT_BASE));
      const title = parseEtMarketCategoryHeading(html1);
      const pagination = parseEtMarketPagination(html1);
      const pagesToScrape = Math.max(1, pagination.totalPages);
      let rawRows = 0;

      for (let page = 1; page <= pagesToScrape; page++) {
        const html =
          page === 1 ? html1 : await fetchHtml(etMarketCategoryPageUrl(canon, page, DEFAULT_BASE));
        const listing = parseEtMarketCategoryListing(html, DEFAULT_BASE, canon);
        rawRows += listing.length;
        for (const item of listing) {
          pairRows.push({ item, categoryUrl: canon });
        }
        if (delayMs > 0 && page < pagesToScrape) await sleep(delayMs);
      }

      perCategory.push({
        categoryUrl: canon,
        title,
        pages: pagesToScrape,
        listingRows: rawRows,
      });

      if (delayMs > 0 && i < categoryUrls.length - 1) await sleep(delayMs);
    }

    mergedListing = mergeEtListingPreferDeeperCategory(pairRows);

    const stubs: UnifiedProduct[] = mergedListing.map((l) => ({
      ...l,
      images: l.imageUrl ? [{ url: l.imageUrl, alt: l.nameUk }] : [],
      specs: [],
    }));

    manifest = {
      scrapedAt: new Date().toISOString(),
      listingUrl: DEFAULT_BASE + "/",
      products: stubs,
      etMarketCrawl: {
        seedUrls,
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
      console.error(`--detail-start ${detailStart} поза діапазоном [0, ${mergedListing.length})`);
      process.exit(1);
    }
    if (endExclusive <= detailStart) {
      console.error("Невірний діапазон: detail-end має бути більше detail-start.");
      process.exit(1);
    }

    console.error(
      `Допарс карток: індекси ${detailStart} … ${endExclusive - 1} (усього ${endExclusive - detailStart})`,
    );

    for (let i = detailStart; i < endExclusive; i++) {
      const item = mergedListing[i];
      const pHtml = await fetchHtml(item.sourceUrl);
      manifest.products[i] = parseEtMarketProductPage(pHtml, DEFAULT_BASE, item);
      if (delayMs > 0) await sleep(delayMs);

      if (checkpointEvery > 0 && (i - detailStart + 1) % checkpointEvery === 0) {
        manifest.scrapedAt = new Date().toISOString();
        await writeManifestFile(manifest, outPath);
        console.error(`checkpoint: збережено ${outPath} (до індексу ${i} включно)`);
      }
    }
  }

  manifest.scrapedAt = new Date().toISOString();
  await writeManifestFile(manifest, outPath);

  const detailedCount = manifest.products.filter(
    (p) => (p as UnifiedProduct).descriptionHtml || (p as UnifiedProduct).specs?.length,
  ).length;

  console.error(
    `OK: категорій ${categoryUrls.length}, товарів у manifest ${manifest.products.length}, ` +
      `з них з описом/спеками ≈${detailedCount} → ${outPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
