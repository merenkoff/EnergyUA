import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatUah } from "@/lib/format";
import { prisma } from "@/lib/prisma";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const row = await prisma.product.findFirst({
    where: { slug, published: true },
    select: {
      nameUk: true,
      seoTitle: true,
      seoDescription: true,
      shortDescription: true,
      mergedIntoProductId: true,
      mergedInto: {
        select: {
          published: true,
          nameUk: true,
          seoTitle: true,
          seoDescription: true,
          shortDescription: true,
        },
      },
    },
  });
  if (!row) return { title: "Не знайдено" };
  const c = row.mergedIntoProductId && row.mergedInto?.published ? row.mergedInto : row;
  return {
    title: c.seoTitle ?? c.nameUk,
    description: c.seoDescription ?? c.shortDescription ?? undefined,
  };
}

function specDisplay(row: {
  valueText: string | null;
  valueNumber: { toString(): string } | null;
  definition: { labelUk: string; unit: string | null; sortOrder: number };
}) {
  if (row.valueText) return row.valueText;
  if (row.valueNumber != null) {
    const n = row.valueNumber.toString();
    return row.definition.unit ? `${n} ${row.definition.unit}` : n;
  }
  return "—";
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const dup = await prisma.product.findFirst({
    where: { slug, published: true },
    select: {
      mergedIntoProductId: true,
      mergedInto: { select: { slug: true, published: true } },
    },
  });
  if (!dup) notFound();
  if (dup.mergedIntoProductId && dup.mergedInto?.published) {
    redirect(`/product/${dup.mergedInto.slug}`);
  }

  const product = await prisma.product.findFirst({
    where: { slug, published: true },
    include: {
      brand: true,
      category: { include: { parent: { select: { slug: true, nameUk: true } } } },
      images: { orderBy: { sortOrder: "asc" } },
      specs: {
        include: { definition: true },
      },
    },
  });

  if (!product) notFound();

  const specs = [...product.specs].sort((a, b) => a.definition.sortOrder - b.definition.sortOrder);

  const crumbs: { href: string; label: string }[] = [
    { href: "/", label: "Головна" },
    { href: "/catalog", label: "Каталог" },
  ];
  if (product.category.parent && product.category.parent.slug !== "tepla-pidloga") {
    crumbs.push({
      href: `/catalog/${product.category.parent.slug}`,
      label: product.category.parent.nameUk,
    });
  }
  crumbs.push({ href: `/catalog/${product.category.slug}`, label: product.category.nameUk });
  crumbs.push({ href: `/product/${product.slug}`, label: product.nameUk });

  const showPrice = product.priceVisible && product.priceUah != null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-[var(--muted)]">
        {crumbs.map((b, i) => (
          <span key={`${b.href}-${i}`} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {i < crumbs.length - 1 ? (
              <Link href={b.href} className="hover:text-[var(--accent)]">
                {b.label}
              </Link>
            ) : (
              <span className="text-[var(--foreground)]">{b.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-hover)]">
          {product.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.images[0].url} alt={product.images[0].altUk ?? product.nameUk} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-[var(--muted)]">Галерея — після імпорту фото</div>
          )}
        </div>

        <div>
          {product.brand ? (
            <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">{product.brand.name}</p>
          ) : null}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{product.nameUk}</h1>
          {product.sku ? <p className="mt-2 text-sm text-[var(--muted)]">Код: {product.sku}</p> : null}

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <p className="text-sm text-[var(--muted)]">Орієнтовна вартість</p>
            <p className="mt-1 text-3xl font-semibold">
              {showPrice ? formatUah(product.priceUah) : <span className="text-[var(--muted)]">Уточнюйте у менеджера</span>}
            </p>
            <p className="mt-4 text-xs text-[var(--muted)]">Прямих продажів на сайті поки немає — блок під майбутній кошик і оплату.</p>
          </div>

          {product.shortDescription ? <p className="mt-6 text-lg text-[var(--muted)]">{product.shortDescription}</p> : null}
        </div>
      </div>

      {product.description ? (
        <section className="mt-12 border-t border-[var(--border)] pt-10">
          <h2 className="text-xl font-semibold">Опис</h2>
          <div
            className="mt-4 max-w-3xl space-y-3 text-[var(--muted)] [&_a]:text-[var(--accent)] [&_p]:leading-relaxed"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </section>
      ) : null}

      <section className="mt-12 border-t border-[var(--border)] pt-10">
        <h2 className="text-xl font-semibold">Характеристики</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Таблиця збігається з тим, що зручно парсити з карток ЕТ-маркет / in-heat.</p>
        <dl className="mt-6 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          {specs.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4 sm:px-5">
              <dt className="text-sm text-[var(--muted)]">{row.definition.labelUk}</dt>
              <dd className="text-sm font-medium text-[var(--foreground)] sm:col-span-2">{specDisplay(row)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
