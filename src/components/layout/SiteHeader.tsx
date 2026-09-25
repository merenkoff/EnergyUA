import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { SITE, phoneHref } from "@/lib/siteConfig";

/** Розділи для меню: перші 6 з товарами (решта — на /catalog). */
async function loadNavSections() {
  const root = await prisma.category.findUnique({ where: { slug: CATALOG_ROOT_SLUG }, select: { id: true } });
  if (!root) return [];
  const rows = await prisma.category.findMany({
    where: { parentId: root.id },
    orderBy: [{ sortOrder: "asc" }],
    select: { slug: true, nameUk: true, _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
  });
  return rows.filter((r) => r._count.products > 0).slice(0, 6);
}

export async function SiteHeader() {
  const sections = await loadNavSections();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
          <Link href="/catalog" className="rounded-lg px-3 py-2 text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]">
            Каталог
          </Link>
          <Link href="/brands" className="rounded-lg px-3 py-2 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
            Бренди
          </Link>
          <Link href="/#pidbir" className="rounded-lg px-3 py-2 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
            Підбір
          </Link>
          <Link href="/#kontakty" className="rounded-lg px-3 py-2 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
            Контакти
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {SITE.phone ? (
            <a href={phoneHref(SITE.phone)} className="hidden text-sm font-semibold text-[var(--foreground)] lg:inline">
              {SITE.phone}
            </a>
          ) : null}
          <Link href="/#kontakty" className="btn-primary !px-4 !py-2 text-sm">
            Консультація
          </Link>
        </div>
      </div>
      {sections.length ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 text-[13px] sm:px-6 [scrollbar-width:none]">
            {sections.map((s) => (
              <Link
                key={s.slug}
                href={`/catalog/${s.slug}`}
                className="shrink-0 rounded-full px-3 py-1 text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-dim)]"
              >
                {s.nameUk}
              </Link>
            ))}
            <Link href="/catalog" className="shrink-0 rounded-full px-3 py-1 font-medium text-[var(--secondary)] hover:underline">
              Усі розділи →
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
