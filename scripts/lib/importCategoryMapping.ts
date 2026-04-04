/**
 * ============================================================================
 * ІМПОРТ КАТЕГОРІЙ — ПРОЧИТАЙ ПЕРЕД ЗМІНАМИ
 * ============================================================================
 * Slug-и et-*, inh-* — це лише МАПІНГ URL донора → рядок у нашій БД для товарів.
 * Вони НЕ «дзеркало дерева сайту-донора» і НЕ окремі корені вітрини.
 *
 * Усі категорії, які створює імпорт (плоскі et-*, inh-*), мають parentId =
 * CANONICAL_CATALOG_ROOT_SLUG (`tepla-pidloga`). Товари upsert-яться за
 * externalSource + externalId; категорія — лише поле categoryId.
 *
 * НЕ додавайте нові категорії з parentId = null для «ЕТ» / «IN-HEAT» — тоді на
 * /catalog знову з’являться зайві верхньорівневі картки.
 * ============================================================================
 */
import type { PrismaClient } from "@prisma/client";

/** Єдиний корінь вітрини для навігації; seed + імпорт зобов’язані узгоджуватися з ним. */
export const CANONICAL_CATALOG_ROOT_SLUG = "tepla-pidloga";

/** @deprecated Старі slug коренів імпорту; після повторного import + prune можуть бути видалені з БД. */
export const ET_ROOT_SLUG = "et-market-import";
/** @deprecated Див. ET_ROOT_SLUG. */
export const IN_ROOT_SLUG = "in-heat-import";

/** Порядок розділів ЕТ-маркет у каталозі (sortOrder). */
export const ET_TOP_SEGMENT_ORDER: string[] = [
  "teplyj-pol",
  "termoregulyatory",
  "snegotayanie",
  "avtomatika",
  "kondicionery",
  "akvastorozh",
  "shitovoe-oborudovanie",
];

const ET_TOP_LABELS: Record<string, string> = {
  "teplyj-pol": "Тепла підлога",
  termoregulyatory: "Терморегулятори",
  snegotayanie: "Сніготанення",
  avtomatika: "Автоматика",
  kondicionery: "Кондиціонери",
  akvastorozh: "Аквасторож",
  "shitovoe-oborudovanie": "Щитове обладнання",
};

const IN_HUB_LABELS: Record<string, string> = {
  otoplenie: "Опалення та тепла підлога",
  termoregulyatory: "Терморегулятори",
};

function etTopSortOrder(segment: string): number {
  const i = ET_TOP_SEGMENT_ORDER.indexOf(segment);
  return (i === -1 ? 900 : i) * 10;
}

function humanize(seg: string): string {
  return seg.replace(/-/g, " ").replace(/\s+/g, " ").trim() || seg;
}

/**
 * Перший сегмент шляху et-market.com.ua/teplyj-pol/... → ключ категорії.
 */
export function etFlatSegmentFromCategoryUrl(categoryUrl: string): string {
  const u = new URL(categoryUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return "misc";
  return parts[0];
}

/**
 * Після /ua/ беремо другий сегмент (otoplenie, termoregulyatory), щоб не плодити ua-…
 */
export function inHeatFlatHubFromCategoryUrl(categoryUrl: string): string {
  const u = new URL(categoryUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "ua" && parts.length >= 2) return parts[1];
  return parts[0] ?? "misc";
}

/** Slug листкової категорії під коренем ЕТ (нова схема, без etm-a-b-c). */
export function etFlatCategorySlug(segment: string): string {
  return `et-${segment}`.slice(0, 200);
}

export function inHeatFlatCategorySlug(hub: string): string {
  return `inh-${hub}`.slice(0, 200);
}

function bestTitleFromMap(
  titleMap: Map<string, string>,
  predicate: (pathname: string) => boolean,
  fallback: string,
): string {
  let best = "";
  for (const [key, title] of titleMap) {
    try {
      const path = new URL(key).pathname;
      if (predicate(path) && title.length > best.length) best = title;
    } catch {
      /* skip */
    }
  }
  return (best || fallback).slice(0, 240);
}

export async function ensureCanonicalCatalogRootId(prisma: PrismaClient): Promise<string> {
  const c = await prisma.category.findUnique({
    where: { slug: CANONICAL_CATALOG_ROOT_SLUG },
    select: { id: true },
  });
  if (!c) {
    throw new Error(
      `Немає категорії slug="${CANONICAL_CATALOG_ROOT_SLUG}". Виконайте: npm run db:seed`,
    );
  }
  return c.id;
}

/**
 * Категорія для товару ЕТ: tepla-pidloga → et-teplyj-pol (один рівень, без окремого кореня «ЕТ-маркет»).
 */
export async function ensureEtFlatCategory(
  prisma: PrismaClient,
  sourceCategoryUrl: string,
  titleMap: Map<string, string>,
): Promise<string> {
  const u = new URL(sourceCategoryUrl);
  if (!u.hostname.includes("et-market.com.ua")) {
    throw new Error(`Очікувався et-market URL: ${sourceCategoryUrl}`);
  }
  const segment = etFlatSegmentFromCategoryUrl(sourceCategoryUrl);
  const slug = etFlatCategorySlug(segment);
  const rootId = await ensureCanonicalCatalogRootId(prisma);

  const labelDefault = ET_TOP_LABELS[segment] ?? humanize(segment);
  const nameUk =
    ET_TOP_LABELS[segment] ??
    bestTitleFromMap(
      titleMap,
      (path) => path.startsWith(`/${segment}/`) || path === `/${segment}`,
      labelDefault,
    );

  /** Після демо-розділів (sortOrder 10, 20); усередині блоку ЕТ — порядок як у ET_TOP_SEGMENT_ORDER. */
  const sortOrder = 100 + etTopSortOrder(segment);

  const cat = await prisma.category.upsert({
    where: { slug },
    create: {
      slug,
      nameUk,
      parentId: rootId,
      sortOrder,
    },
    update: {
      nameUk,
      parentId: rootId,
      sortOrder,
    },
  });
  return cat.id;
}

/**
 * IN-HEAT: tepla-pidloga → inh-otoplenie / inh-termoregulyatory (плоско).
 */
export async function ensureInHeatFlatCategory(
  prisma: PrismaClient,
  sourceCategoryUrl: string,
  titleMap: Map<string, string>,
): Promise<string> {
  const u = new URL(sourceCategoryUrl);
  if (!u.hostname.includes("in-heat.kiev.ua")) {
    throw new Error(`Очікувався in-heat URL: ${sourceCategoryUrl}`);
  }
  const hub = inHeatFlatHubFromCategoryUrl(sourceCategoryUrl);
  const slug = inHeatFlatCategorySlug(hub);
  const rootId = await ensureCanonicalCatalogRootId(prisma);

  const labelDefault = IN_HUB_LABELS[hub] ?? humanize(hub);
  const prefix = `/ua/${hub}`;
  const nameUk =
    IN_HUB_LABELS[hub] ??
    bestTitleFromMap(
      titleMap,
      (path) => path.startsWith(`${prefix}/`) || path === prefix,
      labelDefault,
    );

  const sortOrder =
    200 + (hub === "otoplenie" ? 10 : hub === "termoregulyatory" ? 20 : hub === "misc" ? 5 : 50);

  const cat = await prisma.category.upsert({
    where: { slug },
    create: {
      slug,
      nameUk,
      parentId: rootId,
      sortOrder,
    },
    update: {
      nameUk,
      parentId: rootId,
      sortOrder,
    },
  });
  return cat.id;
}
