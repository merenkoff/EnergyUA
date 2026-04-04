import { load } from "cheerio";
import type { UnifiedListingItem, UnifiedProduct } from "./types";
import { assertNotAntiBot } from "./http";

const BASE = "https://in-heat.kiev.ua";

export function resolveInHeatUrl(href: string | undefined, baseUrl: string = BASE): string | null {
  if (!href || href === "#" || href.startsWith("javascript:")) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Витягує число ціни з рядка на кшталт «2 260 грн.» */
export function parsePriceUah(text: string): number | undefined {
  const cleaned = text.replace(/\u00A0/g, " ").trim();
  const m = cleaned.match(/([\d\s]+)\s*грн/i);
  if (!m) return undefined;
  const n = parseInt(m[1].replace(/\s/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function slugFromInHeatProductUrl(url: string): string {
  const u = new URL(url);
  const base = u.pathname.split("/").pop() ?? "item";
  return base.replace(/\.html?$/i, "").replace(/\.php$/i, "") || "item";
}

/**
 * Максимальний номер сторінки Bitrix (PAGEN_1) з блоку пагінації.
 */
export function parseInHeatCategoryMaxPage(html: string): number {
  assertNotAntiBot(html, "in-heat");
  const $ = load(html);
  let max = 1;
  $('#pagenavigation a[href*="PAGEN_1="]').each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const m of href.matchAll(/PAGEN_1=(\d+)/g)) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  });
  $("#pagenavigation .bx-pagination-container li span").each((_, el) => {
    const t = $(el).text().trim();
    const n = parseInt(t, 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

/** URL списку категорії з пагінацією Bitrix. */
export function inHeatCategoryListingUrl(categoryUrl: string, page: number, baseUrl: string = BASE): string {
  const normalized = categoryUrl.includes("://") ? categoryUrl : resolveInHeatUrl(categoryUrl, baseUrl)!;
  const u = new URL(normalized);
  if (page <= 1) {
    u.searchParams.delete("PAGEN_1");
  } else {
    u.searchParams.set("PAGEN_1", String(page));
  }
  return u.toString();
}

/**
 * Посилання на підрозділи каталогу з модального меню `#catalog-menu-dialog` (головна сторінка /ua/).
 */
export function discoverInHeatCategoryUrls(menuHtml: string, pathPrefixes: string[], baseUrl: string = BASE): string[] {
  assertNotAntiBot(menuHtml, "in-heat");
  const $ = load(menuHtml);
  const found = new Set<string>();

  const matchesPrefix = (pathname: string) =>
    pathPrefixes.some((prefix) => {
      const p = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      return pathname === p || pathname.startsWith(`${p}/`);
    });

  $("#catalog-menu-dialog a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const abs = resolveInHeatUrl(href, baseUrl);
    if (!abs) return;
    let pathname: string;
    try {
      pathname = new URL(abs).pathname;
    } catch {
      return;
    }
    if (/\.html?$/i.test(pathname)) return;
    if (/\/(tag|filter)\//i.test(pathname)) return;
    if (pathname.includes("/apply/")) return;
    if (!matchesPrefix(pathname)) return;
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length < 3) return;
    const path = "/" + parts.join("/") + "/";
    found.add(new URL(path, baseUrl).toString());
  });

  return [...found].sort();
}

export function parseInHeatCategoryHeading(html: string): string | undefined {
  assertNotAntiBot(html, "in-heat");
  const $ = load(html);
  const t = $("#pagetitle h1, .pageTitle h1, h1.bx-title, h1")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  return t || undefined;
}

/**
 * Сторінка розділу каталогу (Bitrix + dresscode): тільки товари з основного списку #catalogSection.
 * Лише картки з посиланням на `.html` (виключає статті/огляди в списку).
 */
export function parseInHeatCategoryListing(
  html: string,
  baseUrl: string = BASE,
  sourceCategoryUrl?: string,
): UnifiedListingItem[] {
  assertNotAntiBot(html, "in-heat");
  const $ = load(html);
  const items: UnifiedListingItem[] = [];
  const seen = new Set<string>();

  $("#catalogSection .productTable").each((_, el) => {
    const block = $(el);
    const linkEl = block.find("a.name").first();
    const href = linkEl.attr("href");
    const abs = resolveInHeatUrl(href, baseUrl);
    if (!abs) return;
    try {
      if (!/\.html?$/i.test(new URL(abs).pathname)) return;
    } catch {
      return;
    }

    const nameUk = linkEl.find("span.middle").text().trim() || linkEl.text().trim();
    if (!nameUk) return;

    const sku = block.find("span.changeArticle1").first().text().trim() || undefined;
    const priceText = block.find(".wrapper_price a.price").first().text();
    const priceUah = parsePriceUah(priceText);
    const offerId = block.find("a.addCart").attr("data-id");

    let imageUrl: string | undefined;
    const lazy = block.find("img.lazy").first();
    const lazySrc = lazy.attr("data-lazy");
    const src = lazy.attr("src") || block.find(".productColImage img").first().attr("src");
    const raw = lazySrc || src;
    if (raw && !raw.includes("lazy.svg")) {
      imageUrl = resolveInHeatUrl(raw, baseUrl) ?? undefined;
    }

    const slug = slugFromInHeatProductUrl(abs);
    const externalId = slug;

    if (seen.has(abs)) return;
    seen.add(abs);

    items.push({
      source: "in_heat",
      externalId,
      sourceUrl: abs,
      slug,
      nameUk,
      sku,
      priceUah,
      priceVisible: priceUah != null,
      imageUrl,
      bitrixOfferId: offerId,
      sourceCategoryUrl,
    });
  });

  return items;
}

function absolutizeHtmlImages(html: string, baseUrl: string): string {
  return html.replace(/\ssrc="(\/[^"]+)"/g, (_m, p1: string) => {
    const u = resolveInHeatUrl(p1, baseUrl);
    return u ? ` src="${u}"` : ` src="${p1}"`;
  });
}

/**
 * Картка товару: опис (#detailText), характеристики (table.stats у #elementProperties).
 */
export function parseInHeatProductPage(html: string, baseUrl: string = BASE, listing?: Partial<UnifiedListingItem>): UnifiedProduct {
  assertNotAntiBot(html, "in-heat");
  const $ = load(html);

  const nameUk = $("h1.changeName, h1#browse").first().text().trim() || listing?.nameUk || "";
  const root = $("#catalogElement");
  const sku =
    $('meta[itemprop="sku"]').attr("content")?.trim() ||
    $("#reviewAnd_article .changeArticle_replace.changeArticle2").first().attr("data-first-value")?.trim() ||
    root.find("span.changeArticle").not(".changeArticle1").first().attr("data-first-value")?.trim() ||
    root.find("span.changeArticle").not(".changeArticle1").first().text().trim() ||
    listing?.sku ||
    undefined;

  const priceText = root.find(".wrapper_price a.price").first().text() || $(".wrapper_price a.price").first().text();
  const priceUah = parsePriceUah(priceText) ?? listing?.priceUah;
  const offerId =
    root.find("a.addCart").first().attr("data-id") || $("a.addCart").first().attr("data-id") || listing?.bitrixOfferId;

  const ogImage = $('meta[property="og:image"]').attr("content");
  const images: { url: string; alt?: string }[] = [];

  if (ogImage) {
    const u = resolveInHeatUrl(ogImage, baseUrl);
    if (u) images.push({ url: u, alt: nameUk });
  }

  root.find(".picture img, #pictureSlider img").add($("#pictureSlider img, .slidesBox img")).each((_, img) => {
    const el = $(img);
    const raw = el.attr("data-lazy") || el.attr("src");
    if (!raw || raw.includes("lazy.svg")) return;
    const u = resolveInHeatUrl(raw, baseUrl);
    if (u && !images.some((x) => x.url === u)) images.push({ url: u, alt: el.attr("alt") || undefined });
  });

  let descriptionHtml: string | undefined;
  const detail = $("#detailText .changeDescription").first();
  if (detail.length) {
    descriptionHtml = absolutizeHtmlImages(detail.html() ?? "", baseUrl);
  }

  const specs: { group?: string; label: string; value: string }[] = [];
  let currentGroup: string | undefined;
  $("#elementProperties table.stats tr").each((_, row) => {
    const tr = $(row);
    if (tr.hasClass("cap")) {
      currentGroup = tr.find("td").first().text().replace(/\s+/g, " ").trim() || undefined;
      return;
    }
    const nameCell = tr.find("td.name span[itemprop=name], td.name").first();
    const valCell = tr.find("td[itemprop=value]").first();
    let label = nameCell.attr("content")?.trim() || nameCell.text().trim();
    let value = valCell.text().replace(/\s+/g, " ").trim();
    if (valCell.find("a").length) {
      value = valCell.find("a").first().text().trim() || value;
    }
    if (!label || !value) return;
    specs.push({ group: currentGroup, label, value });
  });

  const canonical = $('link[rel="canonical"]').attr("href");
  const ogUrl = $('meta[property="og:url"]').attr("content");
  const resolved =
    (canonical && resolveInHeatUrl(canonical, baseUrl)) ||
    (ogUrl && resolveInHeatUrl(ogUrl, baseUrl)) ||
    listing?.sourceUrl ||
    "";
  const sourceUrl = resolved;
  const slug = listing?.slug ?? (sourceUrl ? slugFromInHeatProductUrl(sourceUrl) : "item");
  const externalId = listing?.externalId ?? slug;

  return {
    source: "in_heat",
    externalId,
    sourceUrl: sourceUrl || listing?.sourceUrl || "",
    slug,
    nameUk: nameUk || listing?.nameUk || slug,
    sku,
    priceUah,
    priceVisible: priceUah != null,
    imageUrl: listing?.imageUrl ?? images[0]?.url,
    bitrixOfferId: offerId,
    sourceCategoryUrl: listing?.sourceCategoryUrl,
    shortDescription: $('meta[name="description"]').attr("content")?.trim(),
    descriptionHtml,
    images,
    specs,
  };
}
