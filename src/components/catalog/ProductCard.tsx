import Link from "next/link";
import type { Brand, Product } from "@prisma/client";
import { formatUah } from "@/lib/format";

type ProductCardProduct = Pick<
  Product,
  "slug" | "nameUk" | "sku" | "priceUah" | "priceVisible" | "shortDescription"
> & {
  brand: Pick<Brand, "name"> | null;
  images: { url: string; altUk: string | null }[];
};

export function ProductCard({ product }: { product: ProductCardProduct }) {
  const showPrice = product.priceVisible && product.priceUah != null;
  const priceLabel = showPrice ? formatUah(product.priceUah) : "Ціну уточнюйте";
  const cover = product.images[0];

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow-md">
      <Link href={`/product/${product.slug}`} className="relative block aspect-[4/3] bg-gradient-to-br from-[var(--surface)] to-[var(--surface-hover)]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- зовнішні URL з імпорту (як на сторінці товару)
          <img
            src={cover.url}
            alt={cover.altUk ?? product.nameUk}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[var(--muted)]">
            Фото товару
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        {product.brand ? (
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">{product.brand.name}</p>
        ) : null}
        <Link href={`/product/${product.slug}`} className="text-base font-semibold leading-snug text-[var(--foreground)] group-hover:text-[var(--accent)]">
          {product.nameUk}
        </Link>
        {product.shortDescription ? (
          <p className="line-clamp-2 text-sm text-[var(--muted)]">{product.shortDescription}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
          <div>
            <p className={`text-lg font-semibold ${showPrice ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
              {priceLabel}
            </p>
            {product.sku ? <p className="text-xs text-[var(--muted)]">Код: {product.sku}</p> : null}
          </div>
          <span className="rounded-full bg-[var(--surface-hover)] px-3 py-1 text-xs font-medium text-[var(--foreground)]">
            Детальніше
          </span>
        </div>
      </div>
    </article>
  );
}
