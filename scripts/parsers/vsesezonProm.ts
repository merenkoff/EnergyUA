/**
 * Vsesezon.com.ua (Prom.ua): товари з JSON-LD Product у сторінках категорій та карток.
 */
import * as cheerio from "cheerio";
import type { UnifiedProduct } from "./types";

const SOURCE = "vsesezon" as const;

function absUrl(siteOrigin: string, pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, siteOrigin).toString();
  } catch {
    return pathOrUrl;
  }
}

function asImageArray(image: unknown): string[] {
  if (!image) return [];
  if (typeof image === "string") return [image];
  if (Array.isArray(image)) return image.filter((x): x is string => typeof x === "string");
  return [];
}

function offerPrice(offers: Record<string, unknown> | undefined): number | undefined {
  if (!offers) return undefined;
  const agg = offers["@type"] === "AggregateOffer";
  const raw = agg
    ? (offers.lowPrice as string | number | undefined) ?? (offers.highPrice as string | number | undefined)
    : (offers.price as string | number | undefined);
  if (raw == null) return undefined;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function offerUrl(offers: Record<string, unknown> | undefined, siteOrigin: string): string | null {
  const u = offers?.url;
  if (typeof u !== "string" || !u.trim()) return null;
  return absUrl(siteOrigin, u.trim());
}

function externalIdFromProductUrl(productUrl: string): string | null {
  const m = productUrl.match(/\/p(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Усі Product з application/ld+json на сторінці (категорія або товар).
 */
export function parseVsesezonJsonLdProducts(
  html: string,
  siteOrigin: string,
  sourceCategoryUrl: string,
): UnifiedProduct[] {
  const $ = cheerio.load(html);
  const out: UnifiedProduct[] = [];
  const seen = new Set<string>();

  $("script[type='application/ld+json']").each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const objs = Array.isArray(data) ? data : [data];
    for (const o of objs) {
      if (!o || typeof o !== "object") continue;
      const rec = o as Record<string, unknown>;
      if (rec["@type"] !== "Product") continue;

      const offersRaw = rec.offers;
      const offers =
        offersRaw && typeof offersRaw === "object"
          ? (offersRaw as Record<string, unknown>)
          : undefined;

      const productUrl = offerUrl(offers, siteOrigin);
      if (!productUrl) continue;

      const externalId = externalIdFromProductUrl(productUrl);
      if (!externalId) continue;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      const nameUk = typeof rec.name === "string" ? rec.name.trim() : "";
      if (!nameUk) continue;

      const descRaw = typeof rec.description === "string" ? rec.description.trim() : "";
      const descriptionHtml = descRaw ? `<div class="import-vsesezon-desc">${escapeHtmlBlock(descRaw)}</div>` : undefined;
      const shortDescription =
        descRaw.length > 320 ? `${descRaw.slice(0, 317).trim()}…` : descRaw || undefined;

      const imgs = asImageArray(rec.image);
      const priceUah = offerPrice(offers);
      const sku = typeof rec.sku === "string" ? rec.sku.trim() : undefined;

      const specs: UnifiedProduct["specs"] = [];
      if (typeof rec.brand === "string" && rec.brand.trim()) {
        specs.push({ label: "Бренд", value: rec.brand.trim() });
      }

      out.push({
        source: SOURCE,
        externalId,
        sourceUrl: productUrl,
        slug: `vsesezon-${externalId}`,
        nameUk,
        sku: sku || undefined,
        priceUah,
        priceVisible: priceUah != null && priceUah > 0,
        imageUrl: imgs[0],
        sourceCategoryUrl: canonicalVsesezonCategoryUrl(sourceCategoryUrl),
        shortDescription,
        descriptionHtml,
        images: imgs.map((url) => ({ url })),
        specs,
      });
    }
  });

  return out;
}

function escapeHtmlBlock(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>\n");
}

export function canonicalVsesezonCategoryUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    const parts = u.pathname.split("/").filter(Boolean);
    u.pathname = "/" + parts.join("/") + (parts.length ? "/" : "");
    return u.toString();
  } catch {
    return url;
  }
}

/** Перша сторінка категорії: rel=next у <head>. */
export function parseVsesezonNextPageUrl(html: string, baseUrl: string): string | null {
  const m =
    html.match(/<link[^>]*rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i) ??
    html.match(/<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']next["']/i);
  if (!m?.[1]) return null;
  try {
    return new URL(m[1], baseUrl).toString();
  } catch {
    return null;
  }
}

/** З HTML головної / product_list: посилання на групи /ua/g123-slug */
export function discoverVsesezonGroupUrls(html: string, siteOrigin: string): string[] {
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;
    if (!/\/g\d+/i.test(href)) return;
    try {
      const u = new URL(href, siteOrigin);
      if (!u.hostname.includes("vsesezon.com.ua")) return;
      let path = u.pathname;
      if (/^\/g\d+/i.test(path)) {
        u.pathname = "/ua" + path;
        path = u.pathname;
      }
      if (!/^\/ua\/g\d+/i.test(path)) return;
      if (/\.(html?|php)$/i.test(path)) return;
      set.add(canonicalVsesezonCategoryUrl(u.toString()));
    } catch {
      /* skip */
    }
  });
  return [...set].sort();
}

export function parseVsesezonPageTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const t = m?.[1]?.replace(/\s+/g, " ").trim();
  return t?.slice(0, 240) || undefined;
}

/** id групи з URL категорії: …/g2181672-kabel… → 2181672 */
export function vsesezonGroupNumericId(categoryUrl: string): string {
  try {
    const path = new URL(categoryUrl).pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    const m = seg.match(/^g(\d+)/i);
    return m ? m[1] : "0";
  } catch {
    return "0";
  }
}
