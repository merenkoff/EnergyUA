import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { CATALOG_ROOT_SLUG } from "@/lib/catalogRoot";
import { prisma } from "@/lib/prisma";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { SITE, phoneHref } from "@/lib/siteConfig";

export async function SiteFooter() {
  const root = await prisma.category.findUnique({ where: { slug: CATALOG_ROOT_SLUG }, select: { id: true } });
  const sections = root
    ? await prisma.category.findMany({
        where: { parentId: root.id },
        orderBy: [{ sortOrder: "asc" }],
        select: { slug: true, nameUk: true, _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
      })
    : [];
  const brands = await prisma.brand.findMany({
    where: { products: { some: PUBLIC_PRODUCT_WHERE } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
  });
  const topBrands = [...brands].sort((a, b) => b._count.products - a._count.products).slice(0, 10);

  return (
    <footer id="kontakty" className="mt-auto border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--muted)]">{SITE.description}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">Каталог</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {sections
              .filter((s) => s._count.products > 0)
              .map((s) => (
                <li key={s.slug}>
                  <Link href={`/catalog/${s.slug}`} className="text-[var(--muted)] hover:text-[var(--accent-dim)]">
                    {s.nameUk}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">Бренди</h3>
          <ul className="mt-4 space-y-2 text-sm">
            {topBrands.map((b) => (
              <li key={b.slug}>
                <Link href={`/brand/${b.slug}`} className="text-[var(--muted)] hover:text-[var(--accent-dim)]">
                  {b.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/brands" className="font-medium text-[var(--secondary)] hover:underline">
                Усі бренди →
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">Контакти</h3>
          <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
            {SITE.phone ? (
              <li>
                <a href={phoneHref(SITE.phone)} className="font-semibold text-[var(--foreground)]">
                  {SITE.phone}
                </a>
              </li>
            ) : null}
            {SITE.email ? (
              <li>
                <a href={`mailto:${SITE.email}`} className="hover:text-[var(--accent-dim)]">
                  {SITE.email}
                </a>
              </li>
            ) : null}
            <li>{SITE.city}</li>
            <li>{SITE.workHours}</li>
            {!SITE.phone && !SITE.email ? <li className="text-[var(--muted-2)]">Телефон і пошта будуть додані.</li> : null}
          </ul>
        </div>
      </div>
      <div className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-[var(--muted-2)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {SITE.name}. Ціни — за актуальними прайсами постачальників; замовлення й консультація через менеджера.
          </p>
          <Link href="/catalog" className="hover:text-[var(--accent-dim)]">
            Перейти в каталог
          </Link>
        </div>
      </div>
    </footer>
  );
}
