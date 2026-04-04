import Link from "next/link";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { resolveMatsCatalogHref } from "@/lib/catalogLinks";
import { prisma } from "@/lib/prisma";

const CATALOG_ROOT_SLUG = "tepla-pidloga";

export default async function Home() {
  const matsHref = await resolveMatsCatalogHref();

  const root = await prisma.category.findUnique({
    where: { slug: CATALOG_ROOT_SLUG },
    select: { id: true },
  });

  const sections = root
    ? await prisma.category.findMany({
        where: { parentId: root.id },
        orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
        include: {
          _count: { select: { products: true, children: true } },
        },
      })
    : [];

  return (
    <main>
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(244,162,97,0.18),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-[var(--accent)]">Каталог</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Електрична тепла підлога для дому та комерції
          </h1>
          <p className="mt-4 max-w-xl text-lg text-[var(--muted)]">
            Каркас під повноцінний магазин: категорії, картки товарів, характеристики під фільтри — як на ЕТ-маркет та
            аналогах. Онлайн-оплату додамо на наступних кроках.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[#0c0f14] transition hover:bg-[var(--accent-dim)]"
            >
              Відкрити каталог
            </Link>
            {matsHref ? (
              <Link
                href={matsHref}
                className="inline-flex items-center justify-center rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
              >
                Нагрівальні мати
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-xl font-semibold">Розділи</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Оберіть розділ — одразу перехід до товарів.</p>
        {sections.length > 0 ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-[var(--muted)]">
            Немає підрозділів — виконайте <code className="rounded bg-[var(--card)] px-1">npm run db:seed</code> та імпорт.
          </p>
        )}
      </section>
    </main>
  );
}
