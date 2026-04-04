import Link from "next/link";
import type { Category } from "@prisma/client";

type CategoryCardCategory = Pick<Category, "slug" | "nameUk" | "description"> & {
  _count?: { products: number; children: number };
};

export function CategoryCard({ category }: { category: CategoryCardCategory }) {
  const count = category._count?.products ?? 0;
  const sub = category._count?.children ?? 0;

  return (
    <Link
      href={`/catalog/${category.slug}`}
      className="group flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--accent)]/50 hover:shadow-md sm:p-6"
    >
      <h2 className="text-lg font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]">{category.nameUk}</h2>
      {category.description ? <p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{category.description}</p> : null}
      <p className="mt-auto pt-4 text-xs text-[var(--muted)]">
        {sub > 0 ? `${sub} підкатегорій` : null}
        {sub > 0 && count > 0 ? " · " : null}
        {count > 0 ? `${count} товарів` : sub === 0 && count === 0 ? "Перейти" : null}
      </p>
    </Link>
  );
}
