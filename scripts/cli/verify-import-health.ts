/**
 * Вибіркова перевірка цілісності після великого імпорту.
 *
 *   npx tsx scripts/cli/verify-import-health.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.product.count();
  const published = await prisma.product.count({ where: { published: true } });
  const withExt = await prisma.product.count({
    where: { externalSource: { not: null }, externalId: { not: null } },
  });
  const withUrl = await prisma.product.count({ where: { externalUrl: { not: null } } });
  const withCatUrl = await prisma.product.count({ where: { sourceCategoryUrl: { not: null } } });

  const bySource = await prisma.product.groupBy({
    by: ["externalSource"],
    _count: true,
    where: { externalSource: { not: null } },
  });

  const dupSku = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT sku FROM products WHERE sku IS NOT NULL GROUP BY sku HAVING COUNT(*) > 1
    ) t
  `;

  const sample = await prisma.product.findMany({
    where: { externalSource: "et_market" },
    take: 3,
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      nameUk: true,
      externalId: true,
      externalUrl: true,
      sourceCategoryUrl: true,
      category: { select: { slug: true, nameUk: true } },
    },
  });

  console.error(JSON.stringify({ total, published, withExt, withUrl, withCatUrl, bySource, duplicateSkuGroups: Number(dupSku[0]?.c ?? 0) }, null, 2));
  console.error("Приклад (3 останніх et_market):");
  console.error(JSON.stringify(sample, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
