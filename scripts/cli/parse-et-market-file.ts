/**
 * Парсинг ЕТ-маркет з файлу АБО з URL (якщо сервер не блокує IP).
 *
 *   npx tsx scripts/cli/parse-et-market-file.ts --file ./saved.html --out data/et.json
 *   npx tsx scripts/cli/parse-et-market-file.ts --url "https://et-market.com.ua/..." --out data/et.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fetchHtml } from "../parsers/http";
import {
  parseEtMarketCategoryListing,
  parseEtMarketOcfilter,
  parseEtMarketPagination,
  parseEtMarketProductPage,
} from "../parsers/etMarket";
import type { ScrapeManifest, UnifiedProduct } from "../parsers/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const file = arg("--file");
  const url = arg("--url");
  if (!file && !url) {
    console.error("Потрібно: --file path/to/saved.html або --url https://...");
    process.exit(1);
  }
  const outPath = resolve(arg("--out") || "data/scrape/et-market-listing.json");
  const productFile = arg("--product-file");
  const base = arg("--base") || "https://et-market.com.ua";

  const html = file ? await readFile(resolve(file), "utf-8") : await fetchHtml(url!);
  const listing = parseEtMarketCategoryListing(html, base);

  let products: UnifiedProduct[];

  if (productFile) {
    const phtml = await readFile(resolve(productFile), "utf-8");
    const one = parseEtMarketProductPage(phtml, base, listing[0]);
    products = [one];
  } else {
    products = listing.map((l) => ({
      ...l,
      images: l.imageUrl ? [{ url: l.imageUrl, alt: l.nameUk }] : [],
      specs: [],
    }));
  }

  const manifest: ScrapeManifest = {
    scrapedAt: new Date().toISOString(),
    listingUrl: file ?? url ?? "",
    etMarket: {
      filters: parseEtMarketOcfilter(html),
      pagination: parseEtMarketPagination(html),
      pagesScraped: 1,
    },
    products,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.error(`OK: ${listing.length} товарів у списку → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
