import Link from "next/link";

export type CategoryCardData = {
  slug: string;
  nameUk: string;
  description?: string | null;
  cover?: string | null;
  _count?: { products: number; children?: number };
};

/** Картка розділу: фото першого товару, назва, кількість. `size="lg"` — для головної. */
export function CategoryCard({ category, size = "md" }: { category: CategoryCardData; size?: "md" | "lg" }) {
  const count = category._count?.products ?? 0;
  const sub = category._count?.children ?? 0;

  return (
    <Link
      href={`/catalog/${category.slug}`}
      className="group flex overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
    >
      <div className={`product-photo relative shrink-0 border-r border-[var(--border)] ${size === "lg" ? "w-32 sm:w-40" : "w-28"}`}>
        {category.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={category.cover} alt="" loading="lazy" className="h-full w-full object-contain p-3 transition duration-300 group-hover:scale-[1.05]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--surface-2)] text-[var(--muted-2)]">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 15c2-3 4-3 6 0s4 3 6 0 4-3 4 0M4 9c2-3 4-3 6 0s4 3 6 0 4-3 4 0" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h3 className={`font-semibold leading-snug text-[var(--foreground)] group-hover:text-[var(--accent-dim)] ${size === "lg" ? "text-lg" : "text-[15px]"}`}>
          {category.nameUk}
        </h3>
        {category.description ? <p className="mt-1.5 line-clamp-2 text-sm text-[var(--muted)]">{category.description}</p> : null}
        <p className="mt-auto pt-3 text-xs font-medium text-[var(--muted-2)]">
          {count > 0 ? `${count} товарів` : sub > 0 ? `${sub} підрозділів` : "Перейти"}
          <span className="ml-2 text-[var(--accent)] opacity-0 transition group-hover:opacity-100">→</span>
        </p>
      </div>
    </Link>
  );
}
