import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { prisma } from "@/lib/prisma";

type Props = { params: Promise<{ slug: string }> };

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

export default async function CatalogCategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = await prisma.category.findUnique({
    where: { slug },
    include: {
      parent: { select: { slug: true, nameUk: true } },
      children: {
        orderBy: { sortOrder: "asc" },
        include: {
          _count: {
            select: {
              products: { where: { published: true, mergedIntoProductId: null } },
              children: true,
            },
          },
        },
      },
      products: {
        where: { published: true, mergedIntoProductId: null },
        orderBy: { sortOrder: "asc" },
        include: {
          brand: true,
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altUk: true } },
        },
      },
      _count: {
        select: {
          products: { where: { published: true, mergedIntoProductId: null } },
          children: true,
        },
      },
    },
  });

  if (!category) notFound();

  const breadcrumbs = [
    { href: "/", label: "Головна" },
    { href: "/catalog", label: "Каталог" },
  ];
  if (category.parent && category.parent.slug !== "tepla-pidloga") {
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

      <section className="mt-12">
        <h2 className="text-lg font-semibold">Товари</h2>
        {category.products.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">У цьому розділі ще немає опублікованих товарів.</p>
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
