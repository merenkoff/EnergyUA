/**
 * Скидання імпортованого каталогу перед повторним import-manifest-categories.
 *
 *   npx tsx scripts/cli/reset-imported-catalog.ts
 *   npx tsx scripts/cli/reset-imported-catalog.ts --wipe-all-products   # усі товари, включно з демо seed
 *   npx tsx scripts/cli/reset-imported-catalog.ts --dry-run
 *
 * Лише за замовчуванням: товари з externalSource != null; категорії et-*, inh-*, vs-* та застарілі корені імпорту.
 */
import { PrismaClient } from "@prisma/client";
import { ET_ROOT_SLUG, IN_ROOT_SLUG } from "../lib/importCategoryMapping";

const prisma = new PrismaClient();

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  const wipeAll = hasFlag("--wipe-all-products");
  const dry = hasFlag("--dry-run");

  const productFilter = wipeAll
    ? {}
    : {
        externalSource: { not: null } as const,
      };

  const nProd = await prisma.product.count({ where: productFilter });
  const nCat = await prisma.category.count({
    where: {
      OR: [
        { slug: { startsWith: "et-" } },
        { slug: { startsWith: "inh-" } },
        { slug: { startsWith: "vs-" } },
        { slug: ET_ROOT_SLUG },
        { slug: IN_ROOT_SLUG },
      ],
    },
  });

  console.error(
    `[reset-imported] Товарів до видалення: ${nProd}${wipeAll ? " (усі)" : " (лише з externalSource)"}; категорій імпорту: ${nCat}`,
  );
  if (dry) {
    console.error("[reset-imported] --dry-run — змін не робимо");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.updateMany({ data: { mergedIntoProductId: null } });
    const delProd = await tx.product.deleteMany({ where: productFilter });
    console.error(`[reset-imported] Видалено товарів: ${delProd.count}`);

    const delCat = await tx.category.deleteMany({
      where: {
        OR: [
          { slug: { startsWith: "et-" } },
          { slug: { startsWith: "inh-" } },
          { slug: { startsWith: "vs-" } },
          { slug: ET_ROOT_SLUG },
          { slug: IN_ROOT_SLUG },
        ],
      },
    });
    console.error(`[reset-imported] Видалено категорій: ${delCat.count}`);
  });

  console.error("[reset-imported] Готово. Далі: npm run db:rebuild-catalog або import-manifest по файлах.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
