/** Групи міток каталогу. Джерело правди для таксономії (scripts/lib/pricelistTaxonomy.ts) і для адмінки/публічних сторінок. */
export type TagGroupDef = { slug: string; nameUk: string; sortOrder: number };

export const TAG_GROUPS: TagGroupDef[] = [
  { slug: "zastosuvannia", nameUk: "Застосування", sortOrder: 10 },
  { slug: "konstruktsiia", nameUk: "Конструкція", sortOrder: 20 },
  { slug: "funktsii", nameUk: "Функції", sortOrder: 30 },
  { slug: "potuzhnist", nameUk: "Потужність", sortOrder: 40 },
  { slug: "kraina", nameUk: "Країна виробництва", sortOrder: 50 },
  { slug: "komplektatsiia", nameUk: "Комплектація", sortOrder: 60 },
];

export const TAG_GROUP_LABEL: Record<string, string> = Object.fromEntries(TAG_GROUPS.map((g) => [g.slug, g.nameUk]));

/** Порядок групи для сортування (невідомі групи — в кінець). */
export function tagGroupOrder(slug: string | null | undefined): number {
  const g = TAG_GROUPS.find((x) => x.slug === slug);
  return g ? g.sortOrder : 10_000;
}
