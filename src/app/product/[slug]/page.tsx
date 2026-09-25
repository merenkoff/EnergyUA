import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs, type Crumb } from "@/components/catalog/Breadcrumbs";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { TagChips } from "@/components/catalog/TagChips";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { formatUah } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT, formatSpecNumber } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE, priceUnitSuffix } from "@/lib/publicCatalog";
import { SITE, phoneHref } from "@/lib/siteConfig";
import { TAG_GROUP_LABEL, tagGroupOrder } from "@/lib/tagGroups";

type Props = { params: Promise<{ slug: string }> };

/** Картка доступна, якщо товар опублікований і не архівний (архівні — 404, поки прапорець не знято). */
const VISIBLE = { published: true, archived: false } as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const row = await prisma.product.findFirst({
    where: { slug, ...VISIBLE },
    select: {
      nameUk: true,
      seoTitle: true,
      seoDescription: true,
      shortDescription: true,
      mergedIntoProductId: true,
      mergedInto: { select: { published: true, archived: true, nameUk: true, seoTitle: true, seoDescription: true, shortDescription: true } },
    },
  });
  if (!row) return { title: "Не знайдено" };
  const c = row.mergedIntoProductId && row.mergedInto?.published && !row.mergedInto.archived ? row.mergedInto : row;
  return { title: c.seoTitle ?? c.nameUk, description: c.seoDescription ?? c.shortDescription ?? undefined };
}

function specDisplay(row: {
  valueText: string | null;
  valueNumber: { toString(): string } | null;
  definition: { labelUk: string; unit: string | null; sortOrder: number };
}) {
  if (row.valueNumber != null && (row.valueText == null || /^[\d.,\s]+$/.test(row.valueText))) {
    const n = formatSpecNumber(row.valueNumber);
    return row.definition.unit ? `${n} ${row.definition.unit}` : n;
  }
  if (row.valueText) {
    return row.definition.unit && row.valueNumber != null && !row.valueText.includes(row.definition.unit)
      ? `${row.valueText} ${row.definition.unit}`
      : row.valueText;
  }
  if (row.valueNumber != null) {
    const n = formatSpecNumber(row.valueNumber);
    return row.definition.unit ? `${n} ${row.definition.unit}` : n;
  }
  return "—";
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const dup = await prisma.product.findFirst({
    where: { slug, ...VISIBLE },
    select: { mergedIntoProductId: true, mergedInto: { select: { slug: true, published: true, archived: true } } },
  });
  if (!dup) notFound();
  if (dup.mergedIntoProductId && dup.mergedInto?.published && !dup.mergedInto.archived) {
    redirect(`/product/${dup.mergedInto.slug}`);
  }

  const product = await prisma.product.findFirst({
    where: { slug, ...VISIBLE },
    include: {
      brand: true,
      category: { include: { parent: { select: { slug: true, nameUk: true } } } },
      images: { orderBy: { sortOrder: "asc" } },
      specs: { include: { definition: true } },
      tags: { include: { tag: { select: { slug: true, nameUk: true, groupSlug: true, sortOrder: true } } } },
    },
  });
  if (!product) notFound();

  const specs = [...product.specs].sort((a, b) => a.definition.sortOrder - b.definition.sortOrder);
  const tags = product.tags.map((t) => t.tag).sort((a, b) => tagGroupOrder(a.groupSlug) - tagGroupOrder(b.groupSlug) || a.sortOrder - b.sortOrder);
  const tagGroups = new Map<string, typeof tags>();
  for (const t of tags) {
    const k = t.groupSlug ?? "";
    tagGroups.set(k, [...(tagGroups.get(k) ?? []), t]);
  }

  // Схожі: той самий розділ, спершу той самий бренд
  const relatedSame = await prisma.product.findMany({
    where: { ...PUBLIC_PRODUCT_WHERE, categoryId: product.categoryId, id: { not: product.id }, ...(product.brandId ? { brandId: product.brandId } : {}) },
    orderBy: { sortOrder: "asc" },
    take: 4,
    select: PRODUCT_CARD_SELECT,
  });
  const related =
    relatedSame.length >= 4
      ? relatedSame
      : [
          ...relatedSame,
          ...(await prisma.product.findMany({
            where: { ...PUBLIC_PRODUCT_WHERE, categoryId: product.categoryId, id: { notIn: [product.id, ...relatedSame.map((r) => r.id)] } },
            orderBy: { sortOrder: "asc" },
            take: 4 - relatedSame.length,
            select: PRODUCT_CARD_SELECT,
          })),
        ];

  const crumbs: Crumb[] = [{ href: "/", label: "Головна" }, { href: "/catalog", label: "Каталог" }];
  if (product.category.parent && product.category.parent.slug !== CATALOG_ROOT_SLUG) {
    crumbs.push({ href: `/catalog/${product.category.parent.slug}`, label: product.category.parent.nameUk });
  }
  crumbs.push({ href: `/catalog/${product.category.slug}`, label: product.category.nameUk });
  crumbs.push({ label: product.nameUk });

  const showPrice = product.priceVisible && product.priceUah != null;
  const unit = priceUnitSuffix(product.priceUnit);
  const keySpecs = specs.filter((s) => ["power_w", "area_m2", "area_range_m2", "length_m", "power_w_m2", "power_w_m"].includes(s.definition.slug)).slice(0, 4);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={crumbs} />

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
        <ProductGallery images={product.images.map((im) => ({ url: im.url, altUk: im.altUk }))} name={product.nameUk} />

        <div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {product.brand ? (
              <Link href={`/brand/${product.brand.slug}`} className="font-semibold uppercase tracking-[0.12em] text-[var(--accent-dim)] hover:underline">
                {product.brand.name}
              </Link>
            ) : null}
            {product.sku ? <span className="text-[var(--muted-2)]">Арт. {product.sku}</span> : null}
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{product.nameUk}</h1>

          {keySpecs.length ? (
            <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {keySpecs.map((s) => (
                <div key={s.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">{s.definition.labelUk}</dt>
                  <dd className="mt-0.5 text-sm font-semibold">{specDisplay(s)}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--muted)]">Роздрібна ціна{unit ? ` за 1 ${product.priceUnit}` : ""}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight">
                  {showPrice ? (
                    <>
                      {formatUah(product.priceUah)}
                      {unit ? <span className="text-lg font-medium text-[var(--muted)]">{unit}</span> : null}
                    </>
                  ) : (
                    <span className="text-xl font-semibold text-[var(--muted)]">Ціну уточнюйте</span>
                  )}
                </p>
                {showPrice && product.priceKitUah != null ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Комплект з монтажними матеріалами: <span className="font-semibold text-[var(--foreground)]">{formatUah(product.priceKitUah)}</span>
                  </p>
                ) : null}
                {product.priceNote ? <p className="mt-1 text-xs text-[var(--muted-2)]">{product.priceNote}</p> : null}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-soft)] px-3 py-1 text-xs font-semibold text-[var(--success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> Під замовлення
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {SITE.phone ? (
                <a href={phoneHref(SITE.phone)} className="btn-primary">
                  Замовити: {SITE.phone}
                </a>
              ) : (
                <a href="#kontakty" className="btn-primary">
                  Замовити або запитати
                </a>
              )}
              <Link href={`/catalog/${product.category.slug}`} className="btn-secondary">
                Інші {product.category.nameUk.toLowerCase()}
              </Link>
            </div>
            <p className="mt-4 text-xs text-[var(--muted-2)]">Ціна за актуальним прайсом постачальника. Замовлення й доставка — через менеджера.</p>
          </div>

          {product.shortDescription ? <p className="mt-6 text-[15px] leading-relaxed text-[var(--muted)]">{product.shortDescription}</p> : null}

          {tags.length ? (
            <div className="mt-6 space-y-3">
              {[...tagGroups.entries()].map(([g, list]) => (
                <div key={g} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-32 shrink-0 pt-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-2)]">{TAG_GROUP_LABEL[g] ?? "Мітки"}</span>
                  <TagChips tags={list} hrefFor={(t) => `/tag/${t.slug}`} size="xs" />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-14 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        {specs.length ? (
          <section>
            <h2 className="text-xl font-bold tracking-tight">Характеристики</h2>
            <dl className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)]">
              {specs.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_1.2fr] gap-4 px-4 py-2.5 text-sm odd:bg-[var(--surface-2)]/60">
                  <dt className="text-[var(--muted)]">{row.definition.labelUk}</dt>
                  <dd className="font-medium text-[var(--foreground)]">{specDisplay(row)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {product.description ? (
          <section>
            <h2 className="text-xl font-bold tracking-tight">Опис</h2>
            <div className="prose-uk mt-4 text-[15px]" dangerouslySetInnerHTML={{ __html: product.description }} />
          </section>
        ) : null}
      </div>

      {related.length ? (
        <section className="mt-14 border-t border-[var(--border)] pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold tracking-tight">Схожі товари</h2>
            <Link href={`/catalog/${product.category.slug}`} className="text-sm font-medium text-[var(--secondary)] hover:underline">
              Увесь розділ →
            </Link>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
