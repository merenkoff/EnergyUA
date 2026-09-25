import { prisma } from "@/lib/prisma";
import { TAG_GROUP_LABEL, tagGroupOrder } from "@/lib/tagGroups";
import type { AdminTagGroup } from "@/components/admin/AdminProductTags";

/** Усі мітки, згруповані для адмінки (відомі групи за порядком таксономії, решта та «без групи» — в кінці). */
export async function loadTagGroups(): Promise<AdminTagGroup[]> {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
    select: { id: true, slug: true, nameUk: true, groupSlug: true, sortOrder: true },
  });
  const map = new Map<string, AdminTagGroup>();
  for (const t of tags) {
    const key = t.groupSlug ?? "";
    let g = map.get(key);
    if (!g) {
      g = { slug: key, nameUk: TAG_GROUP_LABEL[key] ?? (key || "Без групи"), tags: [] };
      map.set(key, g);
    }
    g.tags.push(t);
  }
  return [...map.values()].sort((a, b) => tagGroupOrder(a.slug || null) - tagGroupOrder(b.slug || null));
}
