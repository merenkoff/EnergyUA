/**
 * Видаляє категорії без товарів (листки дерева, знизу вгору).
 *
 * «Порожня» = немає жодного Product з mergedIntoProductId = null
 * (у каталозі не відображається жодна картка, включно з випадком лише злитих дублікатів).
 *
 *   npx tsx scripts/cli/prune-empty-categories.ts
 *   npx tsx scripts/cli/prune-empty-categories.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Не видаляти ці вузли навіть якщо порожні (структура / демо). */
const PROTECTED_SLUGS = new Set([
  "tepla-pidloga",
  "nagrivalni-maty",
  "griuchi-kabeli",
]);

async function main() {
  const dry = process.argv.includes("--dry-run");
  let removed = 0;
  let round = 0;
  const removedSlugs: string[] = [];

  while (round < 2000) {
    round++;
    const leaves = await prisma.category.findMany({
      where: {
        children: { none: {} },
        OR: [
          { products: { none: {} } },
          {
            AND: [
              { products: { some: {} } },
              { products: { every: { mergedIntoProductId: { not: null } } } },
            ],
          },
        ],
      },
      select: { id: true, slug: true },
    });

    const toDelete = leaves.filter((c) => !PROTECTED_SLUGS.has(c.slug));
    if (!toDelete.length) break;

    for (const c of toDelete) {
      if (dry) {
        removedSlugs.push(c.slug);
        removed++;
        continue;
      }
      await prisma.category.delete({ where: { id: c.id } });
      removedSlugs.push(c.slug);
      removed++;
    }

    if (dry) break;
  }

  if (dry) {
    console.error(`[dry-run] листків без товарів: ${removed}`);
    for (const s of removedSlugs.slice(0, 80)) console.error(`  - ${s}`);
    if (removedSlugs.length > 80) console.error(`  … ще ${removedSlugs.length - 80}`);
  } else {
    console.error(`Видалено порожніх категорій: ${removed}`);
    for (const s of removedSlugs.slice(0, 40)) console.error(`  - ${s}`);
    if (removedSlugs.length > 40) console.error(`  … ще ${removedSlugs.length - 40}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
