/**
 * Завантажує сторінку категорії in-heat, парсить список, опційно збирає повні картки товарів.
 *
 * Приклад:
 *   npx tsx scripts/cli/scrape-in-heat-category.ts --url "https://in-heat.kiev.ua/ua/otoplenie/teplyy-pol-pod-plitku/nagrevatelnye-maty/" --out data/in-heat-maty.json --detail-limit 5
 * Усі сторінки розділу (PAGEN_1): додайте --all-pages (лише з мережі, не з --file).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchHtml } from "../parsers/http";
import {
  inHeatCategoryListingUrl,
  parseInHeatCategoryListing,
  parseInHeatCategoryMaxPage,
  parseInHeatProductPage,
} from "../parsers/inHeat";
import type { ScrapeManifest, UnifiedProduct } from "../parsers/types";

const IN_HEAT_BASE = "https://in-heat.kiev.ua";

function canonicalCategoryUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("PAGEN_1");
  return u.toString();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  const url =
    arg("--url") ||
    "https://in-heat.kiev.ua/ua/otoplenie/teplyy-pol-pod-plitku/nagrevatelnye-maty/";
  const outPath = resolve(arg("--out") || "data/scrape/in-heat-category.json");
  const listingFile = arg("--file");
  const detailLimit = arg("--detail-limit") ? parseInt(arg("--detail-limit")!, 10) : 0;
  const delayMs = arg("--delay") ? parseInt(arg("--delay")!, 10) : 400;
  const skipDetail = hasFlag("--listing-only");
  const allPages = hasFlag("--all-pages");

  let html: string;
  if (listingFile) {
    html = await readFile(resolve(listingFile), "utf-8");
  } else {
    html = await fetchHtml(url);
  }

  const catCanonical = canonicalCategoryUrl(url);
  let listing: ReturnType<typeof parseInHeatCategoryListing>;

  if (allPages && !listingFile) {
    const maxPage = parseInHeatCategoryMaxPage(html);
    const seen = new Set<string>();
    listing = [];
    for (let p = 1; p <= maxPage; p++) {
      const pageUrl = inHeatCategoryListingUrl(catCanonical, p, IN_HEAT_BASE);
      const pageHtml = p === 1 ? html : await fetchHtml(pageUrl);
      for (const row of parseInHeatCategoryListing(pageHtml, IN_HEAT_BASE, catCanonical)) {
        if (seen.has(row.sourceUrl)) continue;
        seen.add(row.sourceUrl);
        listing.push(row);
      }
      if (delayMs > 0 && p < maxPage) await sleep(delayMs);
    }
  } else {
    listing = parseInHeatCategoryListing(html, IN_HEAT_BASE, listingFile ? undefined : catCanonical);
  }
  const toFetch = skipDetail || detailLimit <= 0 ? [] : listing.slice(0, detailLimit);

  const products: UnifiedProduct[] = [];

  for (const item of toFetch) {
    const pHtml = await fetchHtml(item.sourceUrl);
    const full = parseInHeatProductPage(pHtml, IN_HEAT_BASE, item);
    products.push(full);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const manifest: ScrapeManifest = {
    scrapedAt: new Date().toISOString(),
    listingUrl: url,
    products: products.length ? products : (listing as UnifiedProduct[]),
  };

  if (!products.length && listing.length) {
    manifest.products = listing.map((l) => ({
      ...l,
      images: l.imageUrl ? [{ url: l.imageUrl, alt: l.nameUk }] : [],
      specs: [],
    }));
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.error(`OK: ${listing.length} позицій у списку, ${products.length} з повною карткою → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
