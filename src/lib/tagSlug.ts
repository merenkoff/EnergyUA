import slugify from "slugify";
import type { PrismaClient } from "@prisma/client";

/** URL-сегмент мітки з української назви (та сама схема, що й у таксономії: латиниця, дефіси). */
export function tagSlugFromLabel(label: string): string {
  const base = slugify(label.trim(), { lower: true, strict: true, locale: "uk" }).slice(0, 120);
  return base || "mitka";
}

/** Унікальний slug у таблиці tags (суфікс -2, -3, …). */
export async function allocateUniqueTagSlug(prisma: Pick<PrismaClient, "tag">, preferred: string, exceptId?: string): Promise<string> {
  const base = preferred.trim().slice(0, 120) || "mitka";
  let slug = base;
  for (let i = 0; i < 500; i++) {
    const taken = await prisma.tag.findUnique({ where: { slug }, select: { id: true } });
    if (!taken || taken.id === exceptId) return slug;
    slug = `${base}-${i + 2}`;
  }
  throw new Error("Не вдалося підібрати унікальний slug мітки");
}
