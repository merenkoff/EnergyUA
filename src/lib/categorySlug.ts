import slugify from "slugify";
import type { PrismaClient } from "@prisma/client";

/** URL-сегмент для категорії з української назви. */
export function categorySlugFromLabel(label: string): string {
  const base = slugify(label.trim(), { lower: true, strict: true, locale: "uk" }).slice(0, 180);
  return base || "category";
}

/** Унікальний slug у таблиці categories (суфікс -2, -3, …). */
export async function allocateUniqueCategorySlug(
  prisma: Pick<PrismaClient, "category">,
  preferred: string,
): Promise<string> {
  const cleanBase = preferred.trim().slice(0, 180) || "category";
  let slug = cleanBase.slice(0, 200);
  for (let i = 0; i < 500; i++) {
    const taken = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
    const suffix = `-${i + 2}`;
    slug = (cleanBase + suffix).slice(0, 200);
  }
  throw new Error("Не вдалося підібрати унікальний slug");
}
