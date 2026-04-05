/**
 * Пошук кандидатів на дублікати в об’єднаному каталозі (різні джерела / однакові назви).
 *
 *   npx tsx scripts/cli/analyze-catalog-duplicates.ts
 *   npx tsx scripts/cli/analyze-catalog-duplicates.ts --json > dupes.json
 *
 * Евристики:
 * 1) Базовий «код з картки» зі складного sku імпорту (`КОД__source__externalId`) — збіг між et_market та in_heat.
 * 2) Нормалізована назва (регістр, пробіли, базова пунктуація) — кілька карток з різних джерел.
 * 3) В межах одного джерела — повтор однієї нормалізованої назви (якість даних).
 */
import { PrismaClient } from "@prisma/client";
import { normalizeNameKey } from "../lib/productDuplicateSimilarity";

const prisma = new PrismaClient();

/** Витяг артикулу з формату importProductSku: `CODE__et_market__ext` */
export function extractImportBaseCode(sku: string | null): string | null {
  if (!sku?.trim()) return null;
  const m = sku.match(/^(.+?)__(et_market|in_heat)__/);
  if (m) return m[1].trim().toUpperCase().replace(/\s+/g, "");
  return sku.trim().toUpperCase().replace(/\s+/g, "");
}

/** Останній сегмент шляху картки товару без .html — інколи збігається між донорами. */
export function productUrlLeafKey(url: string | null): string | null {
  if (!url?.trim()) return null;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const seg = path.split("/").pop() ?? "";
    const base = seg.replace(/\.html?$/i, "").toLowerCase();
    return base.length >= 6 ? base : null;
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  slug: string;
  nameUk: string;
  sku: string | null;
  externalSource: string | null;
  externalId: string | null;
  externalUrl: string | null;
};

type Group = {
  key: string;
  kind: "base_code_cross_source" | "url_leaf_cross_source" | "name_cross_source" | "name_same_source";
  count: number;
  sources: string[];
  items: Row[];
};

function uniqSources(rows: Row[]): string[] {
  return [...new Set(rows.map((r) => r.externalSource ?? "null"))].sort();
}

function hasMultipleSources(rows: Row[]): boolean {
  const s = new Set(rows.map((r) => r.externalSource).filter(Boolean));
  return s.size >= 2;
}

async function main() {
  const jsonOut = process.argv.includes("--json");

  const products = await prisma.product.findMany({
    select: {
      id: true,
      slug: true,
      nameUk: true,
      sku: true,
      externalSource: true,
      externalId: true,
      externalUrl: true,
    },
    orderBy: { id: "asc" },
  });

  const rows: Row[] = products;

  const byBaseCode = new Map<string, Row[]>();
  for (const r of rows) {
    const code = extractImportBaseCode(r.sku);
    if (!code || code.length < 2) continue;
    const list = byBaseCode.get(code) ?? [];
    list.push(r);
    byBaseCode.set(code, list);
  }

  const byUrlLeaf = new Map<string, Row[]>();
  for (const r of rows) {
    const leaf = productUrlLeafKey(r.externalUrl);
    if (!leaf) continue;
    const list = byUrlLeaf.get(leaf) ?? [];
    list.push(r);
    byUrlLeaf.set(leaf, list);
  }

  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const k = normalizeNameKey(r.nameUk);
    if (k.length < 12) continue;
    const list = byName.get(k) ?? [];
    list.push(r);
    byName.set(k, list);
  }

  const groups: Group[] = [];

  for (const [key, items] of byBaseCode) {
    if (items.length < 2) continue;
    if (!hasMultipleSources(items)) continue;
    groups.push({
      key,
      kind: "base_code_cross_source",
      count: items.length,
      sources: uniqSources(items),
      items,
    });
  }

  for (const [key, items] of byUrlLeaf) {
    if (items.length < 2) continue;
    if (!hasMultipleSources(items)) continue;
    groups.push({
      key,
      kind: "url_leaf_cross_source",
      count: items.length,
      sources: uniqSources(items),
      items,
    });
  }

  for (const [key, items] of byName) {
    if (items.length < 2) continue;
    if (hasMultipleSources(items)) {
      groups.push({
        key: key.slice(0, 120),
        kind: "name_cross_source",
        count: items.length,
        sources: uniqSources(items),
        items,
      });
    } else {
      const src = items[0]?.externalSource;
      if (src && items.every((r) => r.externalSource === src)) {
        groups.push({
          key: key.slice(0, 120),
          kind: "name_same_source",
          count: items.length,
          sources: [src],
          items,
        });
      }
    }
  }

  groups.sort((a, b) => {
    const rank = (k: Group["kind"]) =>
      k === "base_code_cross_source"
        ? 0
        : k === "url_leaf_cross_source"
          ? 1
          : k === "name_cross_source"
            ? 2
            : 3;
    if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
    return b.count - a.count;
  });

  const summary = {
    totalProducts: rows.length,
    withCompositeSku: rows.filter((r) => r.sku?.includes("__et_market__") || r.sku?.includes("__in_heat__")).length,
    groupsBaseCodeCrossSource: groups.filter((g) => g.kind === "base_code_cross_source").length,
    groupsUrlLeafCrossSource: groups.filter((g) => g.kind === "url_leaf_cross_source").length,
    groupsNameCrossSource: groups.filter((g) => g.kind === "name_cross_source").length,
    groupsNameSameSource: groups.filter((g) => g.kind === "name_same_source").length,
  };

  if (jsonOut) {
    console.log(JSON.stringify({ summary, groups }, null, 2));
    await prisma.$disconnect();
    return;
  }

  console.error("=== Зведення ===");
  console.error(JSON.stringify(summary, null, 2));
  console.error("");
  console.error(
    "Пріоритет сигналів: (1) той самий базовий артикул у складі sku з різних сайтів; (2) той самий «листок» URL картки; (3) збіг нормалізованої назви між сайтами.",
  );
  console.error("");

  for (const g of groups) {
    if (g.kind === "name_same_source" && g.count > 8) continue;
    console.error(`--- [${g.kind}] key="${g.key}" (${g.count} шт., джерела: ${g.sources.join(", ")}) ---`);
    for (const it of g.items) {
      console.error(
        `  ${it.externalSource ?? "?"} | ${it.slug} | sku=${it.sku?.slice(0, 60) ?? "—"}…`,
      );
      console.error(`    ${it.nameUk.slice(0, 100)}${it.nameUk.length > 100 ? "…" : ""}`);
    }
    console.error("");
  }

  if (groups.some((g) => g.kind === "name_same_source")) {
    console.error(
      `(Групи name_same_source з >5 карток пропущені в тексті; використайте --json для повного звіту.)`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
