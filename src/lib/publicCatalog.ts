import type { Prisma } from "@prisma/client";

/**
 * Правило видимості товару в публічному каталозі: опублікований, не архівний
 * і не злитий у канонічну картку. Кожна публічна вибірка має використовувати цей фільтр.
 */
export const PUBLIC_PRODUCT_WHERE = {
  published: true,
  archived: false,
  mergedIntoProductId: null,
} satisfies Prisma.ProductWhereInput;

/** Одиниця ціни для виводу: «грн», «грн/м», «грн/м²». */
export function priceUnitSuffix(priceUnit: string | null | undefined): string {
  if (!priceUnit || priceUnit === "шт") return "";
  return `/${priceUnit}`;
}
