import Link from "next/link";
import { formatUah } from "@/lib/format";
import { cardSpecs, type ProductCardData } from "@/lib/productCard";
import { priceUnitSuffix } from "@/lib/publicCatalog";

export function ProductCard({ product }: { product: ProductCardData }) {
  const showPrice = product.priceVisible && product.priceUah != null;
  const cover = product.images[0];
  const specs = cardSpecs(product.specs);
  const href = `/product/${product.slug}`;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]">
      <Link href={href} className="product-photo relative block aspect-[4/3] overflow-hidden border-b border-[var(--border)]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- локальні /api/media та зовнішні URL з імпорту
          <img
            src={cover.url}
            alt={cover.altUk ?? product.nameUk}
            loading="lazy"
            className="h-full w-full object-contain p-4 transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-2)] p-6 text-center text-sm text-[var(--muted-2)]">
            Фото готується
          </div>
        )}
        {product.tags.length ? (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1">
            {product.tags.map(({ tag }) => (
              <span
                key={tag.slug}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  tag.slug === "aktsiia" ? "bg-[var(--tertiary)] text-[var(--foreground)]" : "bg-[var(--secondary-soft)] text-[var(--secondary)]"
                }`}
              >
                {tag.slug === "aktsiia" ? "Акція" : tag.nameUk}
              </span>
            ))}
          </div>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.brand ? (
          <Link href={`/brand/${product.brand.slug}`} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-dim)] hover:underline">
            {product.brand.name}
          </Link>
        ) : null}
        <Link href={href} className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--foreground)] group-hover:text-[var(--accent-dim)]">
          {product.nameUk}
        </Link>
        {specs.length ? (
          <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
            {specs.map((s) => (
              <div key={s.label} className="rounded-lg bg-[var(--surface-2)] px-2 py-1.5">
                <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">{s.label}</dt>
                <dd className="mt-0.5 font-semibold text-[var(--foreground)]">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : product.shortDescription ? (
          <p className="line-clamp-2 text-sm text-[var(--muted)]">{product.shortDescription}</p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div>
            {showPrice ? (
              <>
                <p className="text-lg font-bold text-[var(--foreground)]">
                  {formatUah(product.priceUah)}
                  <span className="text-sm font-medium text-[var(--muted)]">{priceUnitSuffix(product.priceUnit)}</span>
                </p>
                {product.priceKitUah != null ? (
                  <p className="text-xs text-[var(--muted)]">комплект {formatUah(product.priceKitUah)}</p>
                ) : product.sku ? (
                  <p className="text-xs text-[var(--muted-2)]">Арт. {product.sku}</p>
                ) : null}
              </>
            ) : (
              <p className="text-sm font-medium text-[var(--muted)]">Ціну уточнюйте</p>
            )}
          </div>
          <Link href={href} className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition group-hover:border-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-[var(--accent-contrast)]">
            Детальніше
          </Link>
        </div>
      </div>
    </article>
  );
}
