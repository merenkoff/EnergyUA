import Link from "next/link";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { ARCHIVE_ROOT_SLUG, CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

export default async function Home() {
  const root = await prisma.category.findUnique({
    where: { slug: CATALOG_ROOT_SLUG },
    select: { id: true },
  });

  const sections = root
    ? await prisma.category.findMany({
        where: { parentId: root.id },
        orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
        include: {
          _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE }, children: true } },
        },
      })
    : [];

  const archive = await prisma.category.findUnique({ where: { slug: ARCHIVE_ROOT_SLUG }, select: { slug: true } });

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
            Нагрівальні мати й кабель Hemstedt, Fenix, Nexans, Arnold Rak, Magnum, терморегулятори, антиобледеніння та
            суміжне обладнання — за актуальними прайсами постачальників.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/catalog"
              className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[#0c0f14] transition hover:bg-[var(--accent-dim)]"
            >
              Відкрити каталог
            </Link>
            {archive ? (
              <Link
                href={`/catalog/${archive.slug}`}
                className="inline-flex items-center justify-center rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
              >
                Архів
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
          <div className="mt-6 space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Поки що тут немає розділів. Загальний каталог і пошук по товарах — у розділі «Каталог».
            </p>
            <Link
              href="/catalog"
              className="inline-flex text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
            >
              Перейти в каталог
            </Link>
            {process.env.NODE_ENV === "development" ? (
              <p className="text-xs text-[var(--muted)]">
                Локально: <code className="rounded bg-[var(--card)] px-1">npm run db:seed</code> та{" "}
                <code className="rounded bg-[var(--card)] px-1">npm run import:pricelists</code>.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
