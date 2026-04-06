/** Дублікат логіки з scripts/lib/productDuplicateSimilarity для серверного коду. */
export function normalizeNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
