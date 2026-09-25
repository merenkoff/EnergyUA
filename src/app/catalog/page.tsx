import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { loadCatalogSections } from "@/lib/catalogSections";

export const metadata: Metadata = {
  title: "Каталог",
  description: "Розділи каталогу теплої підлоги та суміжного обладнання.",
};

export default async function CatalogIndexPage() {
  const sections = await loadCatalogSections();
  const withProducts = sections.filter((s) => (s._count?.products ?? 0) > 0);
  const empty = sections.filter((s) => (s._count?.products ?? 0) === 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Каталог" }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Каталог</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Оберіть розділ. Усередині — фільтри за застосуванням, конструкцією, потужністю та країною виробництва.
      </p>
      {sections.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Розділів ще немає — виконайте seed та імпорт.</p>
      ) : (
        <>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {withProducts.map((c) => (
              <CategoryCard key={c.slug} category={c} size="lg" />
            ))}
          </div>
          {empty.length ? (
            <p className="mt-8 text-sm text-[var(--muted-2)]">
              Незабаром: {empty.map((c) => c.nameUk).join(", ")}.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
