/**
 * Видаляє порожні «глибокі» категорії старого імпорту (etm-*, inh-ua-*…),
 * не чіпаючи корені, демо та нові плоскі et-*, inh-otoplenie тощо.
 *
 *   npx tsx scripts/cli/prune-legacy-import-categories.ts
 *   npx tsx scripts/cli/prune-legacy-import-categories.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROTECTED_SLUGS = new Set([
  "tepla-pidloga",
  "nagrivalni-maty",
  "griuchi-kabeli",
]);

/** Після reparent плоских категорій ЕТ/IN-HEAT під tepla-pidloga старі корені імпорту часто порожні — видаляємо їх. */
const STALE_IMPORT_ROOT_SLUGS = ["et-market-import", "in-heat-import"] as const;

function isLegacyDeepSlug(slug: string): boolean {
  if (PROTECTED_SLUGS.has(slug)) return false;
  if (slug.startsWith("etm-")) return true;
  /** Залишок глибокого імпорту IN-HEAT (один вузол без дітей). */
  if (slug === "inh-ua") return true;
  if (slug.startsWith("inh-ua-")) return true;
  if (slug.startsWith("inh-") && slug.includes("-") && slug.split("-").length > 3) {
    const rest = slug.slice("inh-".length);
    if (rest.startsWith("ua-")) return true;
  }
  return false;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  let removed = 0;
  let rounds = 0;

  while (rounds < 500) {
    rounds++;
    const leaves = await prisma.category.findMany({
      where: {
        products: { none: {} },
        children: { none: {} },
      },
      select: { id: true, slug: true },
    });

    const toDelete = leaves.filter((c) => isLegacyDeepSlug(c.slug));
    if (!toDelete.length) break;

    for (const c of toDelete) {
      if (dry) {
        console.error(`[dry-run] видалити: ${c.slug}`);
        removed++;
        continue;
      }
      await prisma.category.delete({ where: { id: c.id } });
      removed++;
    }

    if (dry) break;
  }

  console.error(
    dry ? `[dry-run] знайдено листків для видалення: ${removed}` : `Видалено категорій: ${removed}`,
  );

  for (const slug of STALE_IMPORT_ROOT_SLUGS) {
    const c = await prisma.category.findUnique({
      where: { slug },
      include: { _count: { select: { children: true, products: true } } },
    });
    if (!c) continue;
    if (c._count.children > 0 || c._count.products > 0) {
      console.error(`Пропуск ${slug}: ще є дочірні або товари — спочатку повторіть import-manifest.`);
      continue;
    }
    if (dry) {
      console.error(`[dry-run] видалити застарілий корінь імпорту: ${slug}`);
    } else {
      await prisma.category.delete({ where: { id: c.id } });
      console.error(`Видалено застарілий корінь імпорту: ${slug}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
