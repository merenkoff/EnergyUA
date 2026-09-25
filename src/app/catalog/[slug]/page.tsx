import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { TagChips, type TagChip } from "@/components/catalog/TagChips";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ tag?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await prisma.category.findUnique({
    where: { slug },
    select: { nameUk: true, description: true },
  });
  if (!category) return { title: "Не знайдено" };
  return {
    title: category.nameUk,
    description: category.description ?? undefined,
  };
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
        include: {
          _count: {
            select: {
              products: { where: PUBLIC_PRODUCT_WHERE },
              children: true,
            },
          },
        },
      },
      products: {
        where: productWhere,
        orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
        include: {
          brand: true,
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altUk: true } },
        },
      },
      _count: {
        select: {
          products: { where: PUBLIC_PRODUCT_WHERE },
          children: true,
        },
      },
    },
  });

  if (!category) notFound();

  // Мітки товарів цього розділу з кількістю — для звуження списку
  const tagRows = category._count.products
    ? await prisma.productTag.groupBy({
        by: ["tagId"],
        where: { product: { categoryId: category.id, ...productWhere } },
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
  const GROUP_LABEL: Record<string, string> = {
    zastosuvannia: "Застосування",
    konstruktsiia: "Конструкція",
    funktsii: "Функції",
    potuzhnist: "Потужність",
    kraina: "Країна",
    komplektatsiia: "Комплектація",
  };
  const GROUP_ORDER = Object.keys(GROUP_LABEL);
  const chipsByGroup = new Map<string, TagChip[]>();
  for (const t of tagDefs.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const g = t.groupSlug ?? "";
    const arr = chipsByGroup.get(g) ?? [];
    arr.push({ slug: t.slug, nameUk: t.nameUk, groupSlug: t.groupSlug, count: countByTag.get(t.id), active: activeTags.includes(t.slug) });
    chipsByGroup.set(g, arr);
  }
  const groups = [...chipsByGroup.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));

  const breadcrumbs = [
    { href: "/", label: "Головна" },
    { href: "/catalog", label: "Каталог" },
  ];
  if (category.parent && category.parent.slug !== CATALOG_ROOT_SLUG) {
    breadcrumbs.push({ href: `/catalog/${category.parent.slug}`, label: category.parent.nameUk });
  }
  breadcrumbs.push({ href: `/catalog/${category.slug}`, label: category.nameUk });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-[var(--muted)]">
        {breadcrumbs.map((b, i) => (
          <span key={b.href} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {i < breadcrumbs.length - 1 ? (
              <Link href={b.href} className="hover:text-[var(--accent)]">
                {b.label}
              </Link>
            ) : (
              <span className="text-[var(--foreground)]">{b.label}</span>
            )}
          </span>
        ))}
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{category.nameUk}</h1>
      {category.description ? <p className="mt-3 max-w-2xl text-[var(--muted)]">{category.description}</p> : null}

      {category.children.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-lg font-semibold">Підкатегорії</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {category.children.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Звузити за мітками</h2>
            {activeTags.length ? (
              <Link href={`/catalog/${category.slug}`} className="text-xs text-[var(--accent)] underline-offset-4 hover:underline">
                Скинути фільтр
              </Link>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {groups.map(([g, chips]) => (
              <div key={g} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-32 shrink-0 text-xs text-[var(--muted)]">{GROUP_LABEL[g] ?? g}</span>
                <TagChips tags={chips} hrefFor={(t) => tagHref(category.slug, activeTags, t.slug)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-lg font-semibold">
          Товари{" "}
          <span className="text-sm font-normal text-[var(--muted)]">
            {category.products.length}
            {activeTags.length ? ` з ${category._count.products}` : ""}
          </span>
        </h2>
        {category.products.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            {activeTags.length ? "За вибраними мітками товарів немає." : "У цьому розділі ще немає опублікованих товарів."}
          </p>
        ) : (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {category.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
