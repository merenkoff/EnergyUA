import type { MetadataRoute } from "next";
import { SITE } from "@/lib/siteConfig";

/** Поки сайт на тимчасовому домені — SITE_NOINDEX=1 закриває його для роботів; після запуску змінну прибрати. */
export default function robots(): MetadataRoute.Robots {
  if (SITE.noindex) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/ops/", "/api/"] },
    sitemap: SITE.url ? `${SITE.url}/sitemap.xml` : undefined,
  };
}
