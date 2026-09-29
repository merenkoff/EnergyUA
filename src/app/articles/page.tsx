import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ServiceCta } from "@/components/catalog/ServiceCta";
import { ARTICLE_CATEGORIES, formatArticleDate, listArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Статті про теплу підлогу",
  description: "Як обрати, змонтувати й відремонтувати електричну теплу підлогу: інструкції, порівняння, відповіді на часті питання від майстрів із 17-річним досвідом.",
};

export default async function ArticlesPage() {
  const articles = await listArticles();
  const byCat = new Map<string, typeof articles>();
  for (const a of articles) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]);
  const order = Object.keys(ARTICLE_CATEGORIES);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { label: "Статті" }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Статті про теплу підлогу</h1>
      <p className="mt-2 max-w-2xl text-[var(--muted)]">
        Практичні відповіді без води: що обрати під плитку чи ламінат, як монтують мат і кабель, чому підлога не гріє і скільки коштує ремонт.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-10">
          {articles.length === 0 ? <p className="text-sm text-[var(--muted)]">Статей поки немає.</p> : null}
          {order
            .filter((c) => byCat.has(c))
            .map((c) => (
              <section key={c}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">{ARTICLE_CATEGORIES[c]}</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {byCat.get(c)!.map((a) => (
                    <Link
                      key={a.slug}
                      href={`/articles/${a.slug}`}
                      className="group flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]"
                    >
                      <h3 className="text-lg font-semibold leading-snug text-[var(--foreground)] group-hover:text-[var(--accent-dim)]">{a.title}</h3>
                      <p className="mt-2 line-clamp-3 text-sm text-[var(--muted)]">{a.description}</p>
                      <p className="mt-auto pt-4 text-xs text-[var(--muted-2)]">
                        {formatArticleDate(a.date)} · {a.readingMinutes} хв читання
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
        </div>
        <div className="lg:sticky lg:top-[120px] lg:self-start">
          <ServiceCta compact />
        </div>
      </div>
    </main>
  );
}
