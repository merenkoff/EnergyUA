/**
 * Імпорт JSON (формат ScrapeManifest) у PostgreSQL через Prisma.
 *
 *   npx tsx scripts/cli/import-unified-json.ts --file data/scrape/in-heat-maty.json --category-slug nagrivalni-maty
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { reconcileCrossSourceDuplicates } from "../lib/crossSourceDuplicateMerge";
import { importUnifiedProduct } from "../lib/catalogProductImport";
import type { ScrapeManifest } from "../parsers/types";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const file = arg("--file");
  const categorySlug = arg("--category-slug");
  if (!file || !categorySlug) {
    console.error("Потрібно: --file manifest.json --category-slug nagrivalni-maty");
    process.exit(1);
  }
  const publish = !process.argv.includes("--draft");

  const raw = JSON.parse(await readFile(resolve(file), "utf-8")) as ScrapeManifest;
  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) {
    console.error(`Категорія з slug "${categorySlug}" не знайдена. Створіть її або змініть slug.`);
    process.exit(1);
  }

  for (const p of raw.products) {
    await importUnifiedProduct(prisma, p, category.id, publish);
    console.error(`imported: ${p.source} / ${p.externalId} — ${p.nameUk.slice(0, 50)}…`);
  }

  if (!process.argv.includes("--skip-duplicate-reconcile")) {
    await reconcileCrossSourceDuplicates(prisma);
  }

  await prisma.$disconnect();
  console.error(`Готово: ${raw.products.length} товарів.`);
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
