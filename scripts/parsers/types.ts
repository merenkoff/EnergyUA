/** Уніфікований запис для імпорту в ElectroHeat / JSON. */
export type UnifiedListingItem = {
  source: "in_heat" | "et_market";
  externalId: string;
  sourceUrl: string;
  slug: string;
  nameUk: string;
  sku?: string;
  priceUah?: number;
  priceVisible: boolean;
  imageUrl?: string;
  bitrixOfferId?: string;
  /** URL сторінки категорії (in-heat / et-market), звідки взято рядок списку. */
  sourceCategoryUrl?: string;
};

export type UnifiedProduct = UnifiedListingItem & {
  shortDescription?: string;
  descriptionHtml?: string;
  images: { url: string; alt?: string }[];
  specs: { group?: string; label: string; value: string }[];
};

/** Рядок фільтра OCFilter на et-market (виробник, площа, потужність тощо). */
export type EtMarketFilterValueRow = {
  /** Ключ з `name="ocfilter_filter[m]"` → `m`, `30644` … */
  filterKey: string;
  label: string;
  count: number;
  /** URL підкатегорії з уже застосованим фільтром */
  filterUrl: string;
};

export type EtMarketFilterGroupRow = {
  /** `price`, `m`, `30644` … */
  id: string;
  name: string;
  values: EtMarketFilterValueRow[];
  /** Лише для блоку «Ціна» (повзунок). */
  priceRangeUah?: { min: number; max: number };
};

export type EtMarketCategoryMeta = {
  pagination: {
    currentPage: number;
    totalPages: number;
    totalProducts?: number;
    showingFrom?: number;
    showingTo?: number;
  };
  pagesScraped: number;
  filters: EtMarketFilterGroupRow[];
};

export type InHeatCategoryStat = {
  categoryUrl: string;
  title?: string;
  pages: number;
  listingRows: number;
};

export type InHeatCrawlMeta = {
  seedUrl: string;
  pathPrefixes: string[];
  categoryUrls: string[];
  perCategory: InHeatCategoryStat[];
};

export type EtMarketCategoryDiscoverRow = {
  categoryUrl: string;
  title?: string;
  pages: number;
  listingRows: number;
};

export type EtMarketCrawlMeta = {
  seedUrls: string[];
  categoryUrls: string[];
  perCategory: EtMarketCategoryDiscoverRow[];
};

export type ScrapeManifest = {
  scrapedAt: string;
  listingUrl: string;
  products: UnifiedProduct[];
  /** Метадані категорії et-market: фільтри + пагінація (якщо збирали з сайту). */
  etMarket?: EtMarketCategoryMeta;
  /** Повний обхід in-heat: які категорії та скільки сторінок. */
  inHeat?: InHeatCrawlMeta;
  /** Повний обхід et-market: список URL категорій і заголовки. */
  etMarketCrawl?: EtMarketCrawlMeta;
};
