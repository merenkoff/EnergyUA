import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/catalog/ProductCard";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { nameUk: true, description: true } });
  if (!tag) return { title: "Не знайдено" };
  return { title: `Мітка: ${tag.nameUk}`, description: tag.description ?? undefined };
}

/** Сторінка мітки: усі видимі товари з міткою, згруповані за розділами. */
export default async function TagPage({ params }: Props) {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({
    where: { slug },
    include: {
      products: {
        where: { product: PUBLIC_PRODUCT_WHERE },
        include: {
          product: {
            include: {
              brand: true,
              category: { select: { id: true, slug: true, nameUk: true, sortOrder: true } },
              images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altUk: true } },
            },
          },
        },
      },
    },
  });
  if (!tag) notFound();

  const byCategory = new Map<string, { slug: string; nameUk: string; sortOrder: number; products: (typeof tag.products)[number]["product"][] }>();
  for (const { product } of tag.products) {
    const c = product.category;
    const entry = byCategory.get(c.id) ?? { slug: c.slug, nameUk: c.nameUk, sortOrder: c.sortOrder, products: [] };
    entry.products.push(product);
    byCategory.set(c.id, entry);
  }
  const groups = [...byCategory.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const g of groups) g.products.sort((a, b) => a.sortOrder - b.sortOrder || a.nameUk.localeCompare(b.nameUk, "uk"));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          Головна
        </Link>
        <span className="mx-2">/</span>
        <Link href="/catalog" className="hover:text-[var(--accent)]">
          Каталог
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--foreground)]">Мітка: {tag.nameUk}</span>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{tag.nameUk}</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        {tag.description ?? "Товари з цією міткою з усіх розділів каталогу."} Усього: {tag.products.length}.
      </p>

      {groups.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Товарів з цією міткою поки немає.</p>
      ) : (
        groups.map((g) => (
          <section key={g.slug} className="mt-12">
            <h2 className="text-lg font-semibold">
              <Link href={`/catalog/${g.slug}?tag=${tag.slug}`} className="hover:text-[var(--accent)]">
                {g.nameUk}
              </Link>{" "}
              <span className="text-sm font-normal text-[var(--muted)]">{g.products.length}</span>
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
