import { cache } from "react";
import { prisma } from "@/lib/prisma";

const ROOT_SLUG = "tepla-pidloga";

/** Очікуваний slug демо-категорії з seed (нагрівальні мати). */
export const MATS_CATEGORY_SLUG = "nagrivalni-maty";

/**
 * Посилання на розділ матів, лише якщо категорія є в БД і під коренем каталогу.
 * Інакше null — не показувати «Мати» / другий CTA, щоб не було 404.
 * `cache` — один запит на рендер, якщо викликано з шапки й з головної.
 */
export const resolveMatsCatalogHref = cache(async (): Promise<string | null> => {
  const cat = await prisma.category.findFirst({
    where: {
      slug: MATS_CATEGORY_SLUG,
      parent: { slug: ROOT_SLUG },
    },
    select: { slug: true },
  });
  return cat ? `/catalog/${cat.slug}` : null;
});
