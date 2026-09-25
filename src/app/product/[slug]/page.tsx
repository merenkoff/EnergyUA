import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TagChips } from "@/components/catalog/TagChips";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { formatUah } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { priceUnitSuffix } from "@/lib/publicCatalog";

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
      mergedInto: {
        select: {
          published: true,
          archived: true,
          nameUk: true,
          seoTitle: true,
          seoDescription: true,
          shortDescription: true,
        },
      },
    },
  });
  if (!row) return { title: "Не знайдено" };
  const c = row.mergedIntoProductId && row.mergedInto?.published && !row.mergedInto.archived ? row.mergedInto : row;
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
  if (row.valueText) {
    // Текст без одиниці — додаємо одиницю визначення (числові характеристики з прайсів)
    return row.definition.unit && row.valueNumber != null && !row.valueText.includes(row.definition.unit)
      ? `${row.valueText} ${row.definition.unit}`
      : row.valueText;
  }
  if (row.valueNumber != null) {
    const n = row.valueNumber.toString();
    return row.definition.unit ? `${n} ${row.definition.unit}` : n;
  }
  return "—";
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const dup = await prisma.product.findFirst({
    where: { slug, ...VISIBLE },
    select: {
      mergedIntoProductId: true,
      mergedInto: { select: { slug: true, published: true, archived: true } },
    },
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
      specs: {
        include: { definition: true },
      },
      tags: { include: { tag: { select: { slug: true, nameUk: true, groupSlug: true, sortOrder: true } } } },
    },
  });

  if (!product) notFound();

  const specs = [...product.specs].sort((a, b) => a.definition.sortOrder - b.definition.sortOrder);
  const tags = product.tags.map((t) => t.tag).sort((a, b) => a.sortOrder - b.sortOrder);

  const crumbs: { href: string; label: string }[] = [
    { href: "/", label: "Головна" },
    { href: "/catalog", label: "Каталог" },
  ];
  if (product.category.parent && product.category.parent.slug !== CATALOG_ROOT_SLUG) {
    crumbs.push({
      href: `/catalog/${product.category.parent.slug}`,
      label: product.category.parent.nameUk,
    });
  }
  crumbs.push({ href: `/catalog/${product.category.slug}`, label: product.category.nameUk });
  crumbs.push({ href: `/product/${product.slug}`, label: product.nameUk });

  const showPrice = product.priceVisible && product.priceUah != null;
  const unit = priceUnitSuffix(product.priceUnit);

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
            <div className="flex h-full items-center justify-center p-8 text-center text-[var(--muted)]">Фото товару буде додано</div>
          )}
        </div>

        <div>
          {product.brand ? (
            <p className="text-sm font-medium uppercase tracking-wide text-[var(--accent)]">{product.brand.name}</p>
          ) : null}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{product.nameUk}</h1>
          {product.sku ? <p className="mt-2 text-sm text-[var(--muted)]">Артикул: {product.sku}</p> : null}

          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <p className="text-sm text-[var(--muted)]">Роздрібна ціна{unit ? ` за 1 ${product.priceUnit}` : ""}</p>
            <p className="mt-1 text-3xl font-semibold">
              {showPrice ? (
                <>
                  {formatUah(product.priceUah)}
                  {unit ? <span className="text-lg font-normal text-[var(--muted)]">{unit}</span> : null}
                </>
              ) : (
                <span className="text-[var(--muted)]">Уточнюйте у менеджера</span>
              )}
            </p>
            {showPrice && product.priceKitUah != null ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                Комплект: <span className="font-medium text-[var(--foreground)]">{formatUah(product.priceKitUah)}</span>
              </p>
            ) : null}
            {product.priceNote ? <p className="mt-2 text-xs text-[var(--muted)]">{product.priceNote}</p> : null}
            <p className="mt-4 text-xs text-[var(--muted)]">Прямих продажів на сайті поки немає — замовлення через менеджера.</p>
          </div>

          {product.shortDescription ? <p className="mt-6 text-lg text-[var(--muted)]">{product.shortDescription}</p> : null}

          {tags.length ? (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Мітки</p>
              <TagChips tags={tags} hrefFor={(t) => `/tag/${t.slug}`} />
            </div>
          ) : null}
        </div>
      </div>

      {product.description ? (
        <section className="mt-12 border-t border-[var(--border)] pt-10">
          <h2 className="text-xl font-semibold">Опис</h2>
          <div
            className="mt-4 max-w-3xl space-y-3 text-[var(--muted)] [&_a]:text-[var(--accent)] [&_li]:leading-relaxed [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </section>
      ) : null}

      {specs.length ? (
        <section className="mt-12 border-t border-[var(--border)] pt-10">
          <h2 className="text-xl font-semibold">Характеристики</h2>
          <dl className="mt-6 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--card)]">
            {specs.map((row) => (
              <div key={row.id} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4 sm:px-5">
                <dt className="text-sm text-[var(--muted)]">{row.definition.labelUk}</dt>
                <dd className="text-sm font-medium text-[var(--foreground)] sm:col-span-2">{specDisplay(row)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </main>
  );
}
