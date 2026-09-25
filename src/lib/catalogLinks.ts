import { cache } from "react";
import { CATALOG_ROOT_SLUG, MATS_CATEGORY_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";

export { MATS_CATEGORY_SLUG };

/**
 * Посилання на розділ матів, лише якщо категорія є в БД і під коренем каталогу.
 * Інакше null — не показувати «Мати» / другий CTA, щоб не було 404.
 * `cache` — один запит на рендер, якщо викликано з шапки й з головної.
 */
export const resolveMatsCatalogHref = cache(async (): Promise<string | null> => {
  const cat = await prisma.category.findFirst({
    where: {
      slug: MATS_CATEGORY_SLUG,
      parent: { slug: CATALOG_ROOT_SLUG },
    },
    select: { slug: true },
  });
  return cat ? `/catalog/${cat.slug}` : null;
});
