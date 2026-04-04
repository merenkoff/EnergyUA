/**
 * Категорія et-market.com.ua: OCFilter у JSON, опційно всі сторінки списку (?page=), картки товарів.
 *
 *   npx tsx scripts/cli/scrape-et-market-category.ts --url "https://et-market.com.ua/teplyj-pol/nagrevatelnye-maty/" --out data/scrape/et-maty.json
 *   npx tsx scripts/cli/scrape-et-market-category.ts --all-pages --listing-only --out data/scrape/et-all-list.json
 *   npx tsx scripts/cli/scrape-et-market-category.ts --max-pages 3 --detail-limit 5 --out data/scrape/et-sample.json
 *   npx tsx scripts/cli/scrape-et-market-category.ts --filters-only --out data/scrape/et-filters.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchHtml } from "../parsers/http";
import {
  etMarketCategoryPageUrl,
  parseEtMarketCategoryListing,
  parseEtMarketOcfilter,
  parseEtMarketPagination,
  parseEtMarketProductPage,
} from "../parsers/etMarket";
import type { ScrapeManifest, UnifiedListingItem, UnifiedProduct } from "../parsers/types";

function canonicalEtCategoryUrl(url: string, base: string): string {
  const u = new URL(url, base);
  u.search = "";
  u.hash = "";
  const parts = u.pathname.split("/").filter(Boolean);
  u.pathname = "/" + parts.join("/") + "/";
  return u.toString();
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const listingUrl =
    arg("--url") || "https://et-market.com.ua/teplyj-pol/nagrevatelnye-maty/";
  const file = arg("--file");
  const outPath = resolve(arg("--out") || "data/scrape/et-market-category.json");
  const filtersOut = arg("--filters-out");
  const base = arg("--base") || "https://et-market.com.ua";
  const detailLimit = arg("--detail-limit") ? parseInt(arg("--detail-limit")!, 10) : 0;
  const delayMs = arg("--delay") ? parseInt(arg("--delay")!, 10) : 450;
  const listingOnly = process.argv.includes("--listing-only");
  const filtersOnly = process.argv.includes("--filters-only");
  const allPages = process.argv.includes("--all-pages");
  const maxPagesArg = arg("--max-pages");

  const firstHtml = file
    ? await readFile(resolve(file), "utf-8")
    : await fetchHtml(etMarketCategoryPageUrl(listingUrl, 1, base));

  const firstPagination = parseEtMarketPagination(firstHtml);
  const filters = parseEtMarketOcfilter(firstHtml);

  if (filtersOnly) {
    const payload = {
      scrapedAt: new Date().toISOString(),
      listingUrl: file ?? listingUrl,
      filters,
      pagination: firstPagination,
    };
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
    console.error(`OK: ${filters.length} груп фільтрів → ${outPath}`);
    return;
  }

  let pagesToScrape = 1;
  if (file) {
    pagesToScrape = 1;
  } else if (allPages) {
    pagesToScrape = Math.max(1, firstPagination.totalPages);
  } else if (maxPagesArg) {
    const n = parseInt(maxPagesArg, 10);
    pagesToScrape = Math.max(1, Math.min(n, firstPagination.totalPages));
  }

  const seenUrls = new Set<string>();
  const mergedListing: UnifiedListingItem[] = [];

  for (let page = 1; page <= pagesToScrape; page++) {
    if (page > 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    const html =
      page === 1
        ? firstHtml
        : file
          ? firstHtml
          : await fetchHtml(etMarketCategoryPageUrl(listingUrl, page, base));

    const catCanon = file ? undefined : canonicalEtCategoryUrl(listingUrl, base);
    const listing = parseEtMarketCategoryListing(html, base, catCanon);
    for (const it of listing) {
      if (seenUrls.has(it.sourceUrl)) continue;
      seenUrls.add(it.sourceUrl);
      mergedListing.push(it);
    }

    if (file) break;
  }

  const products: UnifiedProduct[] = [];
  const toFetch =
    listingOnly || detailLimit <= 0 ? [] : mergedListing.slice(0, detailLimit);

  for (const item of toFetch) {
    const pHtml = await fetchHtml(item.sourceUrl);
    products.push(parseEtMarketProductPage(pHtml, base, item));
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const manifest: ScrapeManifest = {
    scrapedAt: new Date().toISOString(),
    listingUrl: file ?? listingUrl,
    etMarket: {
      filters,
      pagination: firstPagination,
      pagesScraped: file ? 1 : pagesToScrape,
    },
    products:
      products.length > 0
        ? products
        : mergedListing.map((l) => ({
            ...l,
            images: l.imageUrl ? [{ url: l.imageUrl, alt: l.nameUk }] : [],
            specs: [],
          })),
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");

  if (filtersOut) {
    const fp = resolve(filtersOut);
    await mkdir(dirname(fp), { recursive: true });
    await writeFile(
      fp,
      JSON.stringify(
        {
          scrapedAt: manifest.scrapedAt,
          listingUrl: manifest.listingUrl,
          filters: manifest.etMarket?.filters,
          pagination: manifest.etMarket?.pagination,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.error(`Фільтри → ${fp}`);
  }

  console.error(
    `OK: сторінок ${manifest.etMarket?.pagesScraped ?? 1}, унікальних товарів у списку ${mergedListing.length}, повних карток ${products.length} → ${outPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
