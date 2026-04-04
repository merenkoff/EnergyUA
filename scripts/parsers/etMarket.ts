import { load } from "cheerio";
import type {
  EtMarketCategoryMeta,
  EtMarketFilterGroupRow,
  EtMarketFilterValueRow,
  UnifiedListingItem,
  UnifiedProduct,
} from "./types";
import { assertNotAntiBot } from "./http";

const DEFAULT_BASE = "https://et-market.com.ua";

export function resolveEtUrl(href: string | undefined, baseUrl: string = DEFAULT_BASE): string | null {
  if (!href || href === "#" || href.startsWith("javascript:")) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function parsePriceUahEt(text: string): number | undefined {
  const cleaned = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/([\d\s]+)\s*грн/i);
  if (!m) return undefined;
  const n = parseInt(m[1].replace(/\s/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

function slugFromPath(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean).pop() ?? "item";
  return seg.replace(/\.html?$/i, "") || "item";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEtPriceFromBlock(block: any): number | undefined {
  const span = block.find("span.price_span").first().text().trim();
  if (span && /^\d+$/.test(span)) return parseInt(span, 10);
  const hidden = block.find("input.price-input").attr("value")?.trim();
  if (hidden && /^\d+$/.test(hidden)) return parseInt(hidden, 10);
  const t = block.find(".price-new, .price").first().text();
  return parsePriceUahEt(t);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function etProductIdFromBlock(block: any, html: string): string | undefined {
  const v = block.find("input.polt_id").attr("value")?.trim();
  if (v && /^\d+$/.test(v)) return v;
  const m = html.match(/cart\.add\('(\d+)'/);
  return m?.[1];
}

/** Верхньорівневі розділи каталогу на et-market (хаб + підкатегорії). */
export const ET_MARKET_CATALOG_ROOTS = new Set([
  "teplyj-pol",
  "termoregulyatory",
  "snegotayanie",
  "avtomatika",
  "kondicionery",
  "akvastorozh",
  "shitovoe-oborudovanie",
]);

export function normalizeEtCategoryUrl(pathOrUrl: string, baseUrl: string = DEFAULT_BASE): string {
  const u = new URL(pathOrUrl, baseUrl);
  u.hash = "";
  u.search = "";
  const parts = u.pathname.split("/").filter(Boolean);
  u.pathname = "/" + parts.join("/") + "/";
  return u.toString();
}

function segmentDepthCategory(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * З головної та сторінок хабів збирає URL категорій (не сторінки товарів .html).
 */
export function discoverEtMarketCategoryUrls(html: string, baseUrl: string = DEFAULT_BASE): string[] {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);
  const found = new Set<string>();

  const consider = (href: string | undefined) => {
    if (!href || href === "#" || href.startsWith("javascript:")) return;
    let u: URL;
    try {
      u = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (u.hostname.replace(/^www\./i, "") !== "et-market.com.ua") return;
    const path = u.pathname;
    if (/\.html?$/i.test(path)) return;
    const q = u.search.toLowerCase();
    if (q.includes("filter") || q.includes("search")) return;
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return;
    const root = parts[0];
    if (!ET_MARKET_CATALOG_ROOTS.has(root)) return;
    if (parts.length >= 2) {
      found.add(normalizeEtCategoryUrl(path, baseUrl));
    }
  };

  $("a[href]").each((_, el) => consider($(el).attr("href")));

  for (const root of ET_MARKET_CATALOG_ROOTS) {
    found.add(normalizeEtCategoryUrl(`/${root}/`, baseUrl));
  }

  return [...found].sort();
}

/** Заголовок розділу (h1) для імені категорії в БД. */
export function parseEtMarketCategoryHeading(html: string): string | undefined {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);
  const t = $("#content h1, .page-title h1, h1.heading-title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  return t || undefined;
}

/**
 * Категорія et-market.com.ua (OpenCart): .product-thumb, .prod-name a, span.price_span, input.polt_id.
 * Є fallback під «класичний» .caption h4 a.
 */
export function parseEtMarketCategoryListing(
  html: string,
  baseUrl: string = DEFAULT_BASE,
  sourceCategoryUrl?: string,
): UnifiedListingItem[] {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);
  const items: UnifiedListingItem[] = [];
  const seen = new Set<string>();

  $(".product-thumb").each((_, el) => {
    const block = $(el);
    const blockHtml = block.html() ?? "";

    let link = block.find(".prod-name a").first();
    if (!link.length) {
      link = block.find(".caption h4 a, .caption .name a").first();
    }
    if (!link.length) {
      link = block.find(".image a").first();
    }

    const href = link.attr("href");
    const abs = resolveEtUrl(href, baseUrl);
    if (!abs) return;
    try {
      if (!/\.html?$/i.test(new URL(abs).pathname)) return;
    } catch {
      return;
    }

    const nameUk = link.text().trim();
    if (!nameUk) return;

    const priceUah = parseEtPriceFromBlock(block);

    let imageUrl: string | undefined;
    const img = block.find(".image img").first().length ? block.find(".image img").first() : block.find("a img").first();
    const raw = img.attr("src") || img.attr("data-src");
    if (raw && !raw.includes("lazy")) {
      imageUrl = resolveEtUrl(raw, baseUrl) ?? undefined;
    }

    const slug = slugFromPath(new URL(abs).pathname);
    const productId = etProductIdFromBlock(block, blockHtml);
    const externalId = productId ?? slug;

    if (seen.has(abs)) return;
    seen.add(abs);

    const codeMatch = blockHtml.match(/\(Код:\s*(\d+)\)/i) || blockHtml.match(/Код:\s*(\d+)/i);
    const sku = codeMatch ? codeMatch[1] : undefined;

    items.push({
      source: "et_market",
      externalId,
      sourceUrl: abs,
      slug,
      nameUk,
      sku,
      priceUah,
      priceVisible: priceUah != null,
      imageUrl,
      sourceCategoryUrl,
    });
  });

  return items;
}

/**
 * Сторінка товару OpenCart: заголовок #content h1, атрибути #tab-specification table або .table-attribute.
 */
export function parseEtMarketProductPage(html: string, baseUrl: string = DEFAULT_BASE, listing?: Partial<UnifiedListingItem>): UnifiedProduct {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);

  const nameUk =
    $("h1.cr-product-title[itemprop=name], h1.cr-product-title, #content h1, .product-info h1, h1.page-title")
      .first()
      .text()
      .trim() || listing?.nameUk || "";

  const pid = $('input[name="product_id"]').attr("value")?.trim();
  const priceSpan = $(".pr_pr_in .price_span, .price_w .price_span, .card_inf_in .price_span").first().text().trim();
  let priceUah: number | undefined;
  if (priceSpan && /^\d+$/.test(priceSpan)) priceUah = parseInt(priceSpan, 10);
  else priceUah = parsePriceUahEt($(".price_w, .product-info .price").first().text()) ?? listing?.priceUah;

  const images: { url: string; alt?: string }[] = [];
  $("ul.thumbnails a.thumbnail").each((_, a) => {
    const el = $(a);
    const href = el.attr("href");
    const large = href && href.length > 2 ? resolveEtUrl(href, baseUrl) : null;
    if (large && !images.some((x) => x.url === large)) {
      images.push({ url: large, alt: el.attr("title") || undefined });
    }
  });
  if (!images.length) {
    const main = $('img[itemprop="image"]').first();
    const raw = main.attr("src");
    if (raw) {
      const u = resolveEtUrl(raw, baseUrl);
      if (u) images.push({ url: u, alt: main.attr("alt") || undefined });
    }
  }

  const specs: { group?: string; label: string; value: string }[] = [];
  const descBlock = $('div[itemprop="description"]').first();
  descBlock.find("table.table-bordered tbody tr, table.table tbody tr").each((_, row) => {
    const tr = $(row);
    const cells = tr.find("td");
    if (cells.length < 2) return;
    const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
    const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
    if (!label || !value) return;
    specs.push({ label, value });
  });

  if (!specs.length) {
    $("#tab-specification table tr, .table-attribute tr").each((_, row) => {
      const tr = $(row);
      const cells = tr.find("td, th");
      if (cells.length < 2) return;
      const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
      const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
      if (!label || !value || label.toLowerCase() === value.toLowerCase()) return;
      specs.push({ label, value });
    });
  }

  let descriptionHtml: string | undefined;
  if (descBlock.length) {
    descriptionHtml = descBlock.html() ?? undefined;
  } else {
    const tabDesc = $("#tab-description, .product-description").first();
    if (tabDesc.length) descriptionHtml = tabDesc.html() ?? undefined;
  }

  const canonical = $('link[rel="canonical"]').attr("href");
  const sourceUrl = canonical ? resolveEtUrl(canonical, baseUrl)! : listing?.sourceUrl || "";
  const slug = listing?.slug ?? (sourceUrl ? slugFromPath(new URL(sourceUrl, baseUrl).pathname) : "item");
  const externalId = pid ?? listing?.externalId ?? slug;

  const skuMatch = $(".sku, .model").first().text().match(/(\d{4,})/);
  const sku = listing?.sku ?? (skuMatch ? skuMatch[1] : undefined);

  return {
    source: "et_market",
    externalId,
    sourceUrl,
    slug,
    nameUk: nameUk || listing?.nameUk || slug,
    sku,
    priceUah,
    priceVisible: priceUah != null,
    imageUrl: listing?.imageUrl ?? images[0]?.url,
    sourceCategoryUrl: listing?.sourceCategoryUrl,
    shortDescription: $('meta[name="description"]').attr("content")?.trim(),
    descriptionHtml,
    images,
    specs,
  } satisfies UnifiedProduct;
}

/** URL сторінки категорії з `?page=` (OpenCart). */
export function etMarketCategoryPageUrl(listingUrl: string, page: number, baseUrl: string = DEFAULT_BASE): string {
  const u = new URL(listingUrl, baseUrl);
  if (page <= 1) {
    u.searchParams.delete("page");
  } else {
    u.searchParams.set("page", String(page));
  }
  return u.toString();
}

/**
 * Бічна панель OCFilter: ціна, виробник, площа, тип, монтаж, потужність, країна…
 * Джерело верстки: `#ocfilter-content .ocfilter-option`.
 */
export function parseEtMarketOcfilter(html: string): EtMarketFilterGroupRow[] {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);
  const groups: EtMarketFilterGroupRow[] = [];

  $("#ocfilter-content > .list-group-item.ocfilter-option").each((_, el) => {
    const item = $(el);
    const scale = item.find("#scale-price.scale.ocf-target");

    if (scale.length) {
      const min = parseInt(scale.attr("data-range-min") || "", 10);
      const max = parseInt(scale.attr("data-range-max") || "", 10);
      const name = item.find(".option-name").text().replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
      groups.push({
        id: "price",
        name: name || "Ціна",
        values: [],
        priceRangeUah:
          Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined,
      });
      return;
    }

    const idAttr = item.attr("id") || "";
    const idMatch = idAttr.match(/^option-(.+)$/);
    const groupId = idMatch ? idMatch[1] : idAttr.replace(/^option-/, "") || "unknown";

    const groupName = item
      .find(".option-name")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();

    const values: EtMarketFilterValueRow[] = [];
    item.find(".option-values label").each((__, lab) => {
      const l = $(lab);
      const input = l.find("input.ocf-target").first();
      const fname = input.attr("name") || "";
      const keyMatch = fname.match(/ocfilter_filter\[([^\]]+)\]/);
      const filterKey = keyMatch ? keyMatch[1] : "";
      const filterUrl = input.attr("value")?.trim() || "";
      const label = l.find("a").first().text().replace(/\s+/g, " ").trim();
      const badge = l.find("small.badge").first().text().trim();
      const count = parseInt(badge, 10);
      if (!label || !filterUrl) return;
      values.push({
        filterKey,
        label,
        count: Number.isFinite(count) ? count : 0,
        filterUrl,
      });
    });

    if (groupName && values.length) {
      groups.push({ id: groupId, name: groupName, values });
    }
  });

  return groups;
}

/**
 * Пагінація категорії: `?page=2`, рядок «Показано с 1 по 16 из 569».
 */
export function parseEtMarketPagination(html: string): EtMarketCategoryMeta["pagination"] {
  assertNotAntiBot(html, "et-market");
  const $ = load(html);
  let currentPage = 1;
  const active = $(".pagination li.active span").first().text().trim();
  const ap = parseInt(active, 10);
  if (Number.isFinite(ap) && ap > 0) currentPage = ap;

  let totalPages = currentPage;
  $(".pagination a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const m = href.match(/[?&]page=(\d+)/);
    if (m) {
      const p = parseInt(m[1], 10);
      if (Number.isFinite(p) && p > totalPages) totalPages = p;
    }
  });

  let totalProducts: number | undefined;
  let showingFrom: number | undefined;
  let showingTo: number | undefined;

  const body = $.root().text();
  const shown = body.match(/Показано\s+с\s+(\d+)\s+по\s+(\d+)\s+из\s+(\d+)/i);
  if (shown) {
    showingFrom = parseInt(shown[1], 10);
    showingTo = parseInt(shown[2], 10);
    totalProducts = parseInt(shown[3], 10);
  }

  return {
    currentPage,
    totalPages,
    totalProducts,
    showingFrom,
    showingTo,
  };
}

/** Фільтри + пагінація + товари з однієї HTML-сторінки категорії. */
export function parseEtMarketCategoryPageSnapshot(
  html: string,
  baseUrl: string = DEFAULT_BASE,
  sourceCategoryUrl?: string,
): {
  filters: EtMarketFilterGroupRow[];
  pagination: EtMarketCategoryMeta["pagination"];
  listing: UnifiedListingItem[];
} {
  return {
    filters: parseEtMarketOcfilter(html),
    pagination: parseEtMarketPagination(html),
    listing: parseEtMarketCategoryListing(html, baseUrl, sourceCategoryUrl),
  };
}

/** Для злиття: залишає запис із «глибшою» категорією (менше дублікатів хаб vs підрозділ). */
export function mergeEtListingPreferDeeperCategory(
  rows: { item: UnifiedListingItem; categoryUrl: string }[],
): UnifiedListingItem[] {
  const byUrl = new Map<string, { item: UnifiedListingItem; categoryUrl: string }>();
  for (const row of rows) {
    const prev = byUrl.get(row.item.sourceUrl);
    if (!prev || segmentDepthCategory(row.categoryUrl) >= segmentDepthCategory(prev.categoryUrl)) {
      byUrl.set(row.item.sourceUrl, row);
    }
  }
  return [...byUrl.values()].map((x) => ({
    ...x.item,
    sourceCategoryUrl: normalizeEtCategoryUrl(x.categoryUrl),
  }));
}
