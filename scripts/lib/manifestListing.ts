import type { UnifiedListingItem, UnifiedProduct } from "../parsers/types";

/** Мінімальні поля для допарсу картки з уже збереженого manifest. */
export function unifiedProductAsListingStub(p: UnifiedProduct): UnifiedListingItem {
  return {
    source: p.source,
    externalId: p.externalId,
    sourceUrl: p.sourceUrl,
    slug: p.slug,
    nameUk: p.nameUk,
    sku: p.sku,
    priceUah: p.priceUah,
    priceVisible: p.priceVisible,
    imageUrl: p.imageUrl,
    bitrixOfferId: p.bitrixOfferId,
    sourceCategoryUrl: p.sourceCategoryUrl,
  };
}
