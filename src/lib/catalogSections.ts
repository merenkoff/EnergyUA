import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import type { CategoryCardData } from "@/components/catalog/CategoryCard";

/** Розділи каталогу під коренем з кількістю видимих товарів і фото-обкладинкою (перше фото першого товару). */
export async function loadCatalogSections(): Promise<CategoryCardData[]> {
  const root = await prisma.category.findUnique({ where: { slug: CATALOG_ROOT_SLUG }, select: { id: true } });
  if (!root) return [];
  const sections = await prisma.category.findMany({
    where: { parentId: root.id },
    orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
    select: {
      id: true,
      slug: true,
      nameUk: true,
      description: true,
      _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE }, children: true } },
      products: {
        where: { ...PUBLIC_PRODUCT_WHERE, images: { some: {} } },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } },
      },
    },
  });
  return sections.map((s) => ({
    slug: s.slug,
    nameUk: s.nameUk,
    description: s.description,
    cover: s.products[0]?.images[0]?.url ?? null,
    _count: s._count,
  }));
}
