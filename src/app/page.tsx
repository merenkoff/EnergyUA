import Link from "next/link";
import { CalcForm } from "@/components/catalog/CalcForm";
import { CategoryCard } from "@/components/catalog/CategoryCard";
import { ProductCard } from "@/components/catalog/ProductCard";
import { loadCatalogSections } from "@/lib/catalogSections";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";
import { SITE, phoneHref } from "@/lib/siteConfig";

/** Мітки «застосування» для блоку підбору на головній (порядок показу). */
const PICK_TAGS = ["pid-plytku", "pid-laminat", "u-stiazhku", "vanna", "vodostoky-ta-pokrivlia", "vidkryti-maidanchyky", "truby"];

export default async function Home() {
  const [sections, pickTags, brands, featured] = await Promise.all([
    loadCatalogSections(),
    prisma.tag.findMany({
      where: { slug: { in: PICK_TAGS } },
      select: { slug: true, nameUk: true, description: true, _count: { select: { products: { where: { product: PUBLIC_PRODUCT_WHERE } } } } },
    }),
    prisma.brand.findMany({
      where: { products: { some: PUBLIC_PRODUCT_WHERE } },
      select: { slug: true, name: true, _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } } },
    }),
    prisma.product.findMany({
      where: { ...PUBLIC_PRODUCT_WHERE, images: { some: {} }, priceUah: { not: null }, category: { slug: { in: ["nahrivalni-maty", "nahrivalnyi-kabel", "termorehuliatory", "pid-laminat"] } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      distinct: ["categoryId"],
      take: 4,
      select: PRODUCT_CARD_SELECT,
    }),
  ]);
  const picks = PICK_TAGS.map((s) => pickTags.find((t) => t.slug === s)).filter((t): t is NonNullable<typeof t> => Boolean(t && t._count.products));
  const topBrands = brands.sort((a, b) => b._count.products - a._count.products).slice(0, 12);
  const totalProducts = sections.reduce((n, s) => n + (s._count?.products ?? 0), 0);
  const heroSections = sections.filter((s) => s.cover).slice(0, 4);

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_20%,var(--accent-soft),transparent_70%),radial-gradient(40%_60%_at_10%_90%,var(--secondary-soft),transparent_70%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              {totalProducts} товарів за прайсами {new Date().getFullYear()} року
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-bold leading-[1.1] tracking-tight text-[var(--foreground)] sm:text-5xl">
              Тепла підлога, яка <span className="text-[var(--accent)]">просто працює</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-[var(--muted)]">
              Нагрівальні мати й кабель Hemstedt, Fenix, Nexans, Arnold Rak, Magnum, терморегулятори, антиобледеніння
              покрівлі та труб. Підберемо систему під вашу площу й покриття.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/catalog" className="btn-primary">
                Відкрити каталог
              </Link>
              <Link href="/calc" className="btn-secondary">
                Підібрати за площею
              </Link>
            </div>
            <ul className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-sm">
              {[
                ["12+", "брендів з Європи"],
                ["20 років", "гарантії на мати та кабель"],
                ["1 день", "на підбір і прорахунок"],
              ].map(([n, t]) => (
                <li key={t}>
                  <p className="text-xl font-bold text-[var(--foreground)]">{n}</p>
                  <p className="text-[var(--muted)]">{t}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3 self-center">
            {heroSections.map((s, i) => (
              <Link
                key={s.slug}
                href={`/catalog/${s.slug}`}
                className={`product-photo group relative overflow-hidden rounded-[var(--radius)] border border-[var(--border)] shadow-[var(--shadow-sm)] ${i === 0 ? "row-span-2 aspect-[3/4]" : "aspect-[4/3]"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.cover!} alt={s.nameUk} className="h-full w-full object-contain p-4 transition duration-300 group-hover:scale-[1.04]" />
                <span className="absolute bottom-2 left-2 rounded-full bg-[var(--foreground)]/85 px-2.5 py-1 text-[11px] font-medium text-white">{s.nameUk}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Підбір за застосуванням */}
      {picks.length ? (
        <section id="pidbir" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6">
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Підбір за площею</h2>
                <p className="mt-1 text-[var(--muted)]">Вільна площа, покриття, приміщення — і готовий список матів або кабелю з термостатом.</p>
              </div>
              <Link href="/calc" className="text-sm font-semibold text-[var(--secondary)] hover:underline">
                Як це працює →
              </Link>
            </div>
            <div className="mt-5">
              <CalcForm compact />
            </div>
          </div>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Або за застосуванням</h2>
              <p className="mt-1 text-[var(--muted)]">Куди монтуєте? Покажемо лише те, що підходить.</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {picks.map((t) => (
              <Link
                key={t.slug}
                href={`/tag/${t.slug}`}
                className="group rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:shadow-[var(--shadow-md)]"
              >
                <p className="font-semibold text-[var(--foreground)] group-hover:text-[var(--accent-dim)]">{t.nameUk}</p>
                <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{t.description ?? "Мати, кабель і термостати саме для цього застосування."}</p>
                <p className="mt-3 text-xs font-medium text-[var(--secondary)]">{t._count.products} товарів →</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Розділи */}
      <section className="border-y border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Розділи каталогу</h2>
              <p className="mt-1 text-[var(--muted)]">Усередині розділу — фільтри за застосуванням, потужністю, конструкцією та країною.</p>
            </div>
            <Link href="/catalog" className="text-sm font-semibold text-[var(--secondary)] hover:underline">
              Весь каталог →
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections
              .filter((s) => (s._count?.products ?? 0) > 0)
              .map((s) => (
                <CategoryCard key={s.slug} category={s} size="lg" />
              ))}
          </div>
        </div>
      </section>

      {/* Популярні позиції */}
      {featured.length ? (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight">Популярні позиції</h2>
          <p className="mt-1 text-[var(--muted)]">По одній з ключових категорій — щоб зорієнтуватися в цінах.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Бренди */}
      <section className="border-y border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Бренди</h2>
            <Link href="/brands" className="text-sm font-semibold text-[var(--secondary)] hover:underline">
              Усі бренди →
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {topBrands.map((b) => (
              <Link
                key={b.slug}
                href={`/brand/${b.slug}`}
                className="rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent-dim)]"
              >
                {b.name} <span className="ml-1 text-xs font-medium text-[var(--muted-2)]">{b._count.products}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Переваги + контакти */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Актуальні ціни", "Каталог будується з прайсів постачальників, а не зі старих сторінок. Ціна на сайті = ціна в прайсі."],
              ["Офіційні бренди", "Hemstedt, Fenix, Nexans, Arnold Rak, Magnum, Easytherm — з гарантією виробника до 20 років."],
              ["Підбір під площу", "Скажіть площу й покриття — порахуємо мат або кабель, термостат і монтажні матеріали."],
              ["Монтаж і сервіс", "Порадимо монтажника, підкажемо схему укладання й допоможемо з підключенням термостата."],
            ].map(([h, t]) => (
              <div key={h} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
                <h3 className="font-semibold text-[var(--foreground)]">{h}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{t}</p>
              </div>
            ))}
          </div>
          <div className="rounded-[var(--radius)] bg-[var(--foreground)] p-7 text-white shadow-[var(--shadow-md)]">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Консультація</p>
            <h3 className="mt-2 text-2xl font-bold">Не знаєте, що обрати?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Напишіть площу приміщення, тип покриття і чи є стяжка — надішлемо 2–3 варіанти з цінами.
            </p>
            <div className="mt-6 space-y-2 text-sm">
              {SITE.phone ? (
                <a href={phoneHref(SITE.phone)} className="block text-lg font-semibold">
                  {SITE.phone}
                </a>
              ) : null}
              {SITE.email ? (
                <a href={`mailto:${SITE.email}`} className="block text-white/85 underline-offset-4 hover:underline">
                  {SITE.email}
                </a>
              ) : null}
              <p className="text-white/60">
                {SITE.city} · {SITE.workHours}
              </p>
              {!SITE.phone && !SITE.email ? <p className="text-white/50">Контакти будуть додані найближчим часом.</p> : null}
            </div>
            <Link href="/catalog" className="btn-primary mt-6 w-full">
              Перейти в каталог
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
