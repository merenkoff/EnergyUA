/**
 * Переприв’язує товари з et_market / in_heat до вітринних категорій nagrivalni-maty /
 * griuchi-kabeli за полем source_category_url (ті самі правила, що в importCategoryMapping).
 *
 *   npx tsx scripts/cli/rebucket-showcase-categories.ts
 *   npx tsx scripts/cli/rebucket-showcase-categories.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";
import {
  SHOWCASE_CABLE_SLUG,
  SHOWCASE_MAT_SLUG,
  showcaseCategorySlugFromImporterSourceUrl,
} from "../lib/importCategoryMapping";

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry-run");

  const mats = await prisma.category.findUnique({
    where: { slug: SHOWCASE_MAT_SLUG },
    select: { id: true },
  });
  const cables = await prisma.category.findUnique({
    where: { slug: SHOWCASE_CABLE_SLUG },
    select: { id: true },
  });
  if (!mats || !cables) {
    console.error("Потрібні категорії з seed: nagrivalni-maty, griuchi-kabeli.");
    process.exit(1);
  }

  const idBySlug: Record<string, string> = {
    [SHOWCASE_MAT_SLUG]: mats.id,
    [SHOWCASE_CABLE_SLUG]: cables.id,
  };

  const rows = await prisma.product.findMany({
    where: {
      sourceCategoryUrl: { not: null },
      externalSource: { in: ["et_market", "in_heat"] },
    },
    select: {
      id: true,
      categoryId: true,
      externalSource: true,
      sourceCategoryUrl: true,
    },
  });

  let would = 0;
  let updated = 0;

  for (const p of rows) {
    const src = p.externalSource!;
    const url = p.sourceCategoryUrl!.trim();
    const slug = showcaseCategorySlugFromImporterSourceUrl(src, url);
    if (!slug) continue;
    const targetId = idBySlug[slug];
    if (p.categoryId === targetId) continue;
    would++;
    if (!dry) {
      await prisma.product.update({
        where: { id: p.id },
        data: { categoryId: targetId },
      });
      updated++;
    }
  }

  if (dry) {
    console.error(`[dry-run] товарів змінило б категорію: ${would}`);
  } else {
    console.error(`Оновлено category_id: ${updated}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
