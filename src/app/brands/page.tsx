import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

export const metadata: Metadata = { title: "Бренди", description: "Виробники теплої підлоги та обігріву в каталозі." };

export default async function BrandsPage() {
  const brands = await prisma.brand.findMany({
    where: { products: { some: PUBLIC_PRODUCT_WHERE } },
    select: {
      slug: true,
      name: true,
      _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } },
      products: {
        where: { ...PUBLIC_PRODUCT_WHERE, images: { some: {} } },
        take: 1,
        orderBy: { sortOrder: "asc" },
        select: { images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
      },
    },
  });
  brands.sort((a, b) => b._count.products - a._count.products || a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Бренди" }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Бренди</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">Виробники, чиї товари є в каталозі за актуальними прайсами.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {brands.map((b) => (
          <Link
            key={b.slug}
            href={`/brand/${b.slug}`}
            className="group flex items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
          >
            <div className="product-photo h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--border)]">
              {b.products[0]?.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.products[0].images[0].url} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" />
              ) : null}
            </div>
            <div>
              <p className="font-semibold text-[var(--foreground)] group-hover:text-[var(--accent-dim)]">{b.name}</p>
              <p className="text-xs text-[var(--muted-2)]">{b._count.products} товарів</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
