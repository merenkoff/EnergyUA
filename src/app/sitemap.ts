import type { MetadataRoute } from "next";
import { listArticles } from "@/lib/articles";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { SITE } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

/** Карта сайту: розділи, товари, бренди, мітки, статті. Домен — NEXT_PUBLIC_SITE_URL. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url || "";
  const u = (p: string) => `${base}${p}`;
  const [sections, products, brands, tags, articles] = await Promise.all([
    prisma.category.findMany({ where: { parent: { slug: "katalog" } }, select: { slug: true, updatedAt: true } }),
    prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { slug: true, updatedAt: true } }),
    prisma.brand.findMany({ where: { products: { some: PUBLIC_PRODUCT_WHERE } }, select: { slug: true } }),
    prisma.tag.findMany({ where: { products: { some: { product: PUBLIC_PRODUCT_WHERE } } }, select: { slug: true } }),
    listArticles(),
  ]);
  return [
    { url: u("/"), changeFrequency: "weekly", priority: 1 },
    { url: u("/catalog"), changeFrequency: "weekly", priority: 0.9 },
    { url: u("/calc"), changeFrequency: "monthly", priority: 0.8 },
    { url: u("/articles"), changeFrequency: "weekly", priority: 0.8 },
    { url: u("/brands"), changeFrequency: "monthly", priority: 0.5 },
    ...sections.map((s) => ({ url: u(`/catalog/${s.slug}`), lastModified: s.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...articles.map((a) => ({ url: u(`/articles/${a.slug}`), lastModified: a.updated ? new Date(a.updated) : undefined, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...brands.map((b) => ({ url: u(`/brand/${b.slug}`), changeFrequency: "monthly" as const, priority: 0.5 })),
    ...tags.map((t) => ({ url: u(`/tag/${t.slug}`), changeFrequency: "monthly" as const, priority: 0.4 })),
    ...products.map((p) => ({ url: u(`/product/${p.slug}`), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
