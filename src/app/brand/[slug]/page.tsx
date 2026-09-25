import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ProductCard } from "@/components/catalog/ProductCard";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await prisma.brand.findUnique({ where: { slug }, select: { name: true } });
  if (!brand) return { title: "Не знайдено" };
  return { title: `${brand.name} — товари бренду`, description: `Тепла підлога та обігрів ${brand.name}: мати, кабель, терморегулятори за актуальним прайсом.` };
}

/** Сторінка бренду: усі видимі товари, згруповані за розділами. */
export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = await prisma.brand.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!brand) notFound();

  const products = await prisma.product.findMany({
    where: { ...PUBLIC_PRODUCT_WHERE, brandId: brand.id },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { nameUk: "asc" }],
    select: { ...PRODUCT_CARD_SELECT, category: { select: { id: true, slug: true, nameUk: true } } },
  });
  const country = await prisma.tag.findFirst({
    where: { groupSlug: "kraina", products: { some: { product: { brandId: brand.id, ...PUBLIC_PRODUCT_WHERE } } } },
    select: { nameUk: true, slug: true },
  });

  const byCategory = new Map<string, { slug: string; nameUk: string; products: typeof products }>();
  for (const p of products) {
    const entry = byCategory.get(p.category.id) ?? { slug: p.category.slug, nameUk: p.category.nameUk, products: [] };
    entry.products.push(p);
    byCategory.set(p.category.id, entry);
  }
  const groups = [...byCategory.values()];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { href: "/brands", label: "Бренди" }, { label: brand.name }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-dim)]">Бренд</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{brand.name}</h1>
          <p className="mt-2 text-[var(--muted)]">
            {products.length} товарів у {groups.length} {groups.length === 1 ? "розділі" : "розділах"}
            {country ? (
              <>
                {" · "}
                <Link href={`/tag/${country.slug}`} className="hover:text-[var(--accent-dim)]">
                  {country.nameUk}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {groups.length > 1 ? (
          <nav className="flex flex-wrap gap-2 text-sm">
            {groups.map((g) => (
              <a key={g.slug} href={`#${g.slug}`} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent-dim)]">
                {g.nameUk} <span className="text-[var(--muted-2)]">{g.products.length}</span>
              </a>
            ))}
          </nav>
        ) : null}
      </div>

      {groups.map((g) => (
        <section key={g.slug} id={g.slug} className="mt-12 scroll-mt-28">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold tracking-tight">
              {g.nameUk} <span className="text-sm font-normal text-[var(--muted)]">{g.products.length}</span>
            </h2>
            <Link href={`/catalog/${g.slug}`} className="text-sm font-medium text-[var(--secondary)] hover:underline">
              Увесь розділ →
            </Link>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
