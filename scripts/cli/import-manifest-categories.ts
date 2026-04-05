/**
 * Імпорт ScrapeManifest у PostgreSQL.
 *
 * УВАГА: категорії et-*, inh-* — лише цілі для поля categoryId товару (мапінг з
 * sourceCategoryUrl). Батько завжди tepla-pidloga (див. importCategoryMapping.ts).
 * Ключ товару: externalSource + externalId — не плутати з деревом категорій донора.
 *
 *   npx tsx scripts/cli/import-manifest-categories.ts --file data/scrape/et-catalog-DETAIL.json
 *
 * Глибокі дерева за URL (--deep): лише для відладки / старої поведінки (також під tepla-pidloga).
 *
 * Після імпорту: злиття карток ЕТ ↔ IN-HEAT при схожості назви ≥90% (merged_into_product_id).
 * Попередження в stderr для 75–90%. Вимкнути: --skip-duplicate-reconcile.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { reconcileCrossSourceDuplicates } from "../lib/crossSourceDuplicateMerge";
import { importUnifiedProduct } from "../lib/catalogProductImport";
import {
  ensureCanonicalCatalogRootId,
  ensureEtFlatCategory,
  ensureInHeatFlatCategory,
  ensureVsesezonFlatCategory,
} from "../lib/importCategoryMapping";
import type { ScrapeManifest } from "../parsers/types";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function skipDuplicateReconcile() {
  return hasFlag("--skip-duplicate-reconcile");
}

function categoryUrlKey(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  const parts = u.pathname.split("/").filter(Boolean);
  u.pathname = "/" + parts.join("/") + "/";
  return u.toString();
}

function humanizeSegment(seg: string): string {
  return seg.replace(/-/g, " ").replace(/\s+/g, " ").trim() || seg;
}

function titleFromManifestMap(
  map: Map<string, string>,
  urlKey: string,
  segmentFallback: string,
): string {
  const t = map.get(urlKey);
  if (t) return t.slice(0, 240);
  return humanizeSegment(segmentFallback).slice(0, 240);
}

function buildTitleMap(manifest: ScrapeManifest): Map<string, string> {
  const m = new Map<string, string>();
  if (manifest.etMarketCrawl?.perCategory) {
    for (const row of manifest.etMarketCrawl.perCategory) {
      if (row.title) m.set(categoryUrlKey(row.categoryUrl), row.title);
    }
  }
  if (manifest.inHeat?.perCategory) {
    for (const row of manifest.inHeat.perCategory) {
      if (row.title) m.set(categoryUrlKey(row.categoryUrl), row.title);
    }
  }
  if (manifest.vsesezon?.perCategory) {
    for (const row of manifest.vsesezon.perCategory) {
      if (row.title) m.set(categoryUrlKey(row.categoryUrl), row.title);
    }
  }
  return m;
}

async function ensureEtCategoryTreeDeep(leafCategoryUrl: string, titleMap: Map<string, string>): Promise<string> {
  const u = new URL(leafCategoryUrl);
  if (!u.hostname.includes("et-market.com.ua")) {
    throw new Error(`Очікувався et-market URL: ${leafCategoryUrl}`);
  }
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return ensureCanonicalCatalogRootId(prisma);
  }

  const rootId = await ensureCanonicalCatalogRootId(prisma);
  let parentId = rootId;

  for (let i = 0; i < segments.length; i++) {
    const pathSegs = segments.slice(0, i + 1);
    const slug = ("etm-" + pathSegs.join("-")).slice(0, 200);
    const keyUrl = categoryUrlKey(`${u.origin}/${pathSegs.join("/")}/`);
    const nameUk = titleFromManifestMap(titleMap, keyUrl, pathSegs[pathSegs.length - 1]);

    const cat = await prisma.category.upsert({
      where: { slug },
      create: {
        slug,
        nameUk,
        parentId,
        sortOrder: (i + 1) * 10,
      },
      update: { nameUk, parentId },
    });
    parentId = cat.id;
  }

  return parentId;
}

async function ensureInHeatCategoryTreeDeep(leafCategoryUrl: string, titleMap: Map<string, string>): Promise<string> {
  const u = new URL(leafCategoryUrl);
  if (!u.hostname.includes("in-heat.kiev.ua")) {
    throw new Error(`Очікувався in-heat URL: ${leafCategoryUrl}`);
  }
  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return ensureCanonicalCatalogRootId(prisma);
  }

  const rootId = await ensureCanonicalCatalogRootId(prisma);
  let parentId = rootId;

  for (let i = 0; i < segments.length; i++) {
    const pathSegs = segments.slice(0, i + 1);
    const slug = ("inh-" + pathSegs.join("-")).slice(0, 200);
    const keyUrl = categoryUrlKey(`${u.origin}/${pathSegs.join("/")}/`);
    const nameUk = titleFromManifestMap(titleMap, keyUrl, pathSegs[pathSegs.length - 1]);

    const cat = await prisma.category.upsert({
      where: { slug },
      create: {
        slug,
        nameUk,
        parentId,
        sortOrder: (i + 1) * 10,
      },
      update: { nameUk, parentId },
    });
    parentId = cat.id;
  }

  return parentId;
}

async function resolveCategoryId(
  p: { source: string; sourceCategoryUrl?: string },
  titleMap: Map<string, string>,
  deep: boolean,
): Promise<string> {
  if (p.source === "et_market") {
    if (!p.sourceCategoryUrl) {
      return ensureCanonicalCatalogRootId(prisma);
    }
    return deep
      ? ensureEtCategoryTreeDeep(p.sourceCategoryUrl, titleMap)
      : ensureEtFlatCategory(prisma, p.sourceCategoryUrl, titleMap);
  }
  if (p.source === "in_heat") {
    if (!p.sourceCategoryUrl) {
      return ensureCanonicalCatalogRootId(prisma);
    }
    return deep
      ? ensureInHeatCategoryTreeDeep(p.sourceCategoryUrl, titleMap)
      : ensureInHeatFlatCategory(prisma, p.sourceCategoryUrl, titleMap);
  }
  if (p.source === "vsesezon") {
    if (!p.sourceCategoryUrl) {
      return ensureCanonicalCatalogRootId(prisma);
    }
    return ensureVsesezonFlatCategory(prisma, p.sourceCategoryUrl, titleMap);
  }
  throw new Error(`Невідоме джерело: ${p.source}`);
}

async function main() {
  const file = arg("--file");
  if (!file) {
    console.error("Потрібно: --file manifest.json");
    process.exit(1);
  }
  const publish = !hasFlag("--draft");
  const deep = hasFlag("--deep");

  const manifest = JSON.parse(await readFile(resolve(file), "utf-8")) as ScrapeManifest;
  const titleMap = buildTitleMap(manifest);

  if (deep) {
    console.error("Режим --deep: глибоке дерево за URL під tepla-pidloga (відладка).");
  } else {
    console.error("Плоскі категорії: et-*, inh-* як діти tepla-pidloga (товари — за externalSource+externalId).");
  }

  let n = 0;
  for (const p of manifest.products) {
    const categoryId = await resolveCategoryId(p, titleMap, deep);
    await importUnifiedProduct(prisma, p, categoryId, publish);
    n++;
    if (n % 50 === 0) console.error(`… ${n} / ${manifest.products.length}`);
  }

  if (!skipDuplicateReconcile()) {
    console.error("Зведення дублікатів між джерелами (назви, Levenshtein)…");
    await reconcileCrossSourceDuplicates(prisma);
  } else {
    console.error("Пропущено reconcile дублікатів (--skip-duplicate-reconcile).");
  }

  await prisma.$disconnect();
  console.error(`Готово: ${manifest.products.length} товарів (upsert за externalSource+externalId).`);
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
