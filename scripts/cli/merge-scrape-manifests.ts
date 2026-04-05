/**
 * Об’єднує кілька ScrapeManifest у один (товари: останній файл перемагає при однаковому source+externalId).
 *
 *   npx tsx scripts/cli/merge-scrape-manifests.ts --out data/scrape/COMBINED.json \\
 *     data/scrape/et-catalog-DETAIL.json data/scrape/in-heat-catalog-DETAIL.json data/scrape/vsesezon-catalog.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ScrapeManifest, UnifiedProduct } from "../parsers/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function key(p: UnifiedProduct) {
  return `${p.source}\0${p.externalId}`;
}

async function main() {
  const out = arg("--out");
  if (!out) {
    console.error("Потрібно: --out combined.json та шляхи до manifest-ів після --");
    process.exit(1);
  }
  const outPath = resolve(out);
  const dash = process.argv.indexOf("--");
  const files =
    dash === -1 ? [] : process.argv.slice(dash + 1).filter((a) => a && !a.startsWith("-"));
  if (!files.length) {
    console.error("Вкажіть файли після --");
    process.exit(1);
  }

  const byKey = new Map<string, UnifiedProduct>();
  const manifests: ScrapeManifest[] = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(resolve(f), "utf-8")) as ScrapeManifest;
    manifests.push(raw);
    for (const p of raw.products) {
      byKey.set(key(p), p);
    }
  }

  const combined: ScrapeManifest = {
    scrapedAt: new Date().toISOString(),
    listingUrl: manifests[0]?.listingUrl ?? "",
    products: [...byKey.values()],
    etMarketCrawl: manifests.find((m) => m.etMarketCrawl)?.etMarketCrawl,
    inHeat: manifests.find((m) => m.inHeat)?.inHeat,
    vsesezon: manifests.find((m) => m.vsesezon)?.vsesezon,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(combined, null, 2), "utf-8");
  console.error(`Записано ${combined.products.length} товарів → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
