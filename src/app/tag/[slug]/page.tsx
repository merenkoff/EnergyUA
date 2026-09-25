import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ProductCard } from "@/components/catalog/ProductCard";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { TAG_GROUP_LABEL } from "@/lib/tagGroups";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { nameUk: true, description: true } });
  if (!tag) return { title: "Не знайдено" };
  return { title: tag.nameUk, description: tag.description ?? undefined };
}

/** Сторінка мітки: усі видимі товари з міткою, згруповані за розділами. */
export default async function TagPage({ params }: Props) {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true, slug: true, nameUk: true, description: true, groupSlug: true } });
  if (!tag) notFound();

  const products = await prisma.product.findMany({
    where: { ...PUBLIC_PRODUCT_WHERE, tags: { some: { tagId: tag.id } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { nameUk: "asc" }],
    select: { ...PRODUCT_CARD_SELECT, category: { select: { id: true, slug: true, nameUk: true, sortOrder: true } } },
  });

  const byCategory = new Map<string, { slug: string; nameUk: string; products: typeof products }>();
  for (const p of products) {
    const entry = byCategory.get(p.category.id) ?? { slug: p.category.slug, nameUk: p.category.nameUk, products: [] };
    entry.products.push(p);
    byCategory.set(p.category.id, entry);
  }
  const groups = [...byCategory.values()];
  const groupLabel = tag.groupSlug ? TAG_GROUP_LABEL[tag.groupSlug] : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { href: "/catalog", label: "Каталог" }, { label: tag.nameUk }]} />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-dim)]">{groupLabel ?? "Мітка"}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{tag.nameUk}</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        {tag.description ?? "Товари з цією міткою з усіх розділів каталогу."} Усього: {products.length}.
      </p>

      {groups.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Товарів з цією міткою поки немає.</p>
      ) : (
        groups.map((g) => (
          <section key={g.slug} className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold tracking-tight">
                {g.nameUk} <span className="text-sm font-normal text-[var(--muted)]">{g.products.length}</span>
              </h2>
              <Link href={`/catalog/${g.slug}?tag=${tag.slug}`} className="text-sm font-medium text-[var(--secondary)] hover:underline">
                Відкрити в розділі з фільтрами →
              </Link>
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
