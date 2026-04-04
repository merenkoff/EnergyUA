import type { Metadata } from "next";
import Link from "next/link";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { prisma } from "@/lib/prisma";

type CatalogSection = {
  id: string;
  slug: string;
  nameUk: string;
  description: string | null;
  _count: { products: number; children: number };
};

export const metadata: Metadata = {
  title: "Каталог",
  description: "Розділи каталогу теплої підлоги.",
};

const CATALOG_ROOT_SLUG = "tepla-pidloga";

export default async function CatalogIndexPage() {
  const root = await prisma.category.findUnique({
    where: { slug: CATALOG_ROOT_SLUG },
    select: { id: true, description: true },
  });

  const sections: CatalogSection[] = root
    ? await prisma.category.findMany({
        where: { parentId: root.id },
        orderBy: [{ sortOrder: "asc" }, { nameUk: "asc" }],
        include: {
          _count: { select: { products: true, children: true } },
        },
      })
    : [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          Головна
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--foreground)]">Каталог</span>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Каталог</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        {root?.description ??
          "Оберіть розділ. Імпортовані товари з ЕТ-маркет та IN-HEAT згруповані в підрозділах поруч із власними категоріями; прив’язка йде до товару (externalSource + externalId), а не до «дерева донора»."}
      </p>
      {!root ? (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Немає кореневої категорії <code className="rounded bg-[var(--card)] px-1">{CATALOG_ROOT_SLUG}</code> — виконайте{" "}
          <code className="rounded bg-[var(--card)] px-1">npm run db:seed</code>.
        </p>
      ) : sections.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">Підрозділів ще немає. Додайте категорії або запустіть імпорт.</p>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      )}
    </main>
  );
}
