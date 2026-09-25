import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, type Crumb } from "@/components/catalog/Breadcrumbs";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { TagChips, type TagChip } from "@/components/catalog/TagChips";
import { TagFilterSidebar } from "@/components/catalog/TagFilterSidebar";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { TAG_GROUP_LABEL, tagGroupOrder } from "@/lib/tagGroups";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ tag?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug }, select: { nameUk: true, description: true } });
  if (!category) return { title: "Не знайдено" };
  return { title: category.nameUk, description: category.description ?? undefined };
}

function parseTags(raw: string | string[] | undefined): string[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [...new Set(list.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))];
}

function tagHref(slug: string, active: string[], toggle: string): string {
  const next = active.includes(toggle) ? active.filter((t) => t !== toggle) : [...active, toggle];
  return next.length ? `/catalog/${slug}?tag=${next.join(",")}` : `/catalog/${slug}`;
}

export default async function CatalogCategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const activeTags = parseTags((await searchParams).tag);

  const productWhere = {
    ...PUBLIC_PRODUCT_WHERE,
    ...(activeTags.length ? { AND: activeTags.map((t) => ({ tags: { some: { tag: { slug: t } } } })) } : {}),
  };

  const category = await prisma.category.findUnique({
    where: { slug },
    include: {
      parent: { select: { slug: true, nameUk: true } },
      children: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          slug: true,
          nameUk: true,
          description: true,
          _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE }, children: true } },
        },
      },
      products: {
        where: productWhere,
        orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
        select: PRODUCT_CARD_SELECT,
      },
      _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } },
    },
  });

  if (!category) notFound();

  // Мітки товарів розділу (без урахування активного фільтра — щоб можна було комбінувати)
  const tagRows = category._count.products
    ? await prisma.productTag.groupBy({
        by: ["tagId"],
        where: { product: { categoryId: category.id, ...PUBLIC_PRODUCT_WHERE } },
        _count: { _all: true },
      })
    : [];
  const tagDefs = tagRows.length
    ? await prisma.tag.findMany({
        where: { id: { in: tagRows.map((r) => r.tagId) } },
        select: { id: true, slug: true, nameUk: true, groupSlug: true, sortOrder: true },
      })
    : [];
  const countByTag = new Map(tagRows.map((r) => [r.tagId, r._count._all]));
  const chipsByGroup = new Map<string, TagChip[]>();
  for (const t of tagDefs.sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Мітка, яку мають усі товари розділу, нічого не фільтрує — ховаємо
    const n = countByTag.get(t.id) ?? 0;
    if (n === category._count.products && category._count.products > 1) continue;
    const g = t.groupSlug ?? "";
    const arr = chipsByGroup.get(g) ?? [];
    arr.push({ slug: t.slug, nameUk: t.nameUk, groupSlug: t.groupSlug, count: n, active: activeTags.includes(t.slug) });
    chipsByGroup.set(g, arr);
  }
  const groups: [string, TagChip[]][] = [...chipsByGroup.entries()]
    .sort((a, b) => tagGroupOrder(a[0]) - tagGroupOrder(b[0]))
    .map(([g, chips]) => [TAG_GROUP_LABEL[g] ?? g ?? "Інше", chips]);
  const activeChips = groups.flatMap(([, chips]) => chips.filter((c) => c.active));

  const crumbs: Crumb[] = [{ href: "/", label: "Головна" }, { href: "/catalog", label: "Каталог" }];
  if (category.parent && category.parent.slug !== CATALOG_ROOT_SLUG) {
    crumbs.push({ href: `/catalog/${category.parent.slug}`, label: category.parent.nameUk });
  }
  crumbs.push({ label: category.nameUk });

  const isArchive = category.slug === "arkhiv" || category.parent?.slug === "arkhiv";

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={crumbs} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{category.nameUk}</h1>
          {category.description ? <p className="mt-2 max-w-2xl text-[var(--muted)]">{category.description}</p> : null}
        </div>
        <p className="text-sm text-[var(--muted)]">
          {category.products.length}
          {activeTags.length ? ` з ${category._count.products}` : ""} товарів
        </p>
      </div>

      {category.children.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{isArchive ? "Архівні розділи" : "Підрозділи"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {category.children.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        </section>
      ) : null}

      {category._count.products > 0 ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
          {groups.length ? (
            <TagFilterSidebar groups={groups} activeTags={activeTags} hrefFor={(t) => tagHref(category.slug, activeTags, t.slug)} resetHref={`/catalog/${category.slug}`} />
          ) : (
            <div className="hidden lg:block" />
          )}
          <section>
            {activeChips.length ? (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[var(--muted)]">Вибрано:</span>
                <TagChips tags={activeChips} hrefFor={(t) => tagHref(category.slug, activeTags, t.slug)} size="xs" />
              </div>
            ) : null}
            {category.products.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] p-10 text-center text-sm text-[var(--muted)]">
                За вибраними фільтрами товарів немає.
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {category.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : category.children.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">У цьому розділі ще немає опублікованих товарів.</p>
      ) : null}
    </main>
  );
}
