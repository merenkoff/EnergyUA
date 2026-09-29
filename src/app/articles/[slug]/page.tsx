import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { ServiceCta } from "@/components/catalog/ServiceCta";
import { formatArticleDate, getArticle, listArticles } from "@/lib/articles";
import { SITE } from "@/lib/siteConfig";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return { title: "Не знайдено" };
  return {
    title: a.title,
    description: a.description,
    keywords: a.keywords,
    alternates: { canonical: `/articles/${a.slug}` },
    openGraph: { type: "article", title: a.title, description: a.description, publishedTime: a.date, modifiedTime: a.updated, locale: "uk_UA" },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) notFound();
  const others = (await listArticles()).filter((x) => x.slug !== a.slug).slice(0, 4);
  const abs = (p: string) => (SITE.url ? `${SITE.url}${p}` : p);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.description,
      datePublished: a.date,
      dateModified: a.updated,
      inLanguage: "uk",
      author: { "@type": "Organization", name: SITE.name },
      publisher: { "@type": "Organization", name: SITE.name },
      mainEntityOfPage: abs(`/articles/${a.slug}`),
      keywords: a.keywords.join(", "),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Головна", item: abs("/") },
        { "@type": "ListItem", position: 2, name: "Статті", item: abs("/articles") },
        { "@type": "ListItem", position: 3, name: a.title, item: abs(`/articles/${a.slug}`) },
      ],
    },
    ...(a.faq.length
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
          },
        ]
      : []),
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumbs items={[{ href: "/", label: "Головна" }, { href: "/articles", label: "Статті" }, { label: a.title }]} />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-dim)]">{a.categoryLabel}</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{a.title}</h1>
          <p className="mt-3 text-sm text-[var(--muted-2)]">
            <time dateTime={a.date}>{formatArticleDate(a.date)}</time>
            {a.updated && a.updated !== a.date ? <> · оновлено {formatArticleDate(a.updated)}</> : null} · {a.readingMinutes} хв читання
          </p>

          {a.headings.length > 2 ? (
            <nav aria-label="Зміст" className="mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">Зміст</p>
              <ol className="mt-2 grid gap-1 sm:grid-cols-2">
                {a.headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-[var(--secondary)] hover:underline">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <div className="article-body mt-8" dangerouslySetInnerHTML={{ __html: a.html }} />

          <div className="mt-10 lg:hidden">
            <ServiceCta />
          </div>
        </article>

        <aside className="space-y-6 lg:sticky lg:top-[120px] lg:self-start">
          <div className="hidden lg:block">
            <ServiceCta compact />
          </div>
          {others.length ? (
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">Читайте також</p>
              <ul className="mt-3 space-y-3 text-sm">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/articles/${o.slug}`} className="font-medium text-[var(--foreground)] hover:text-[var(--accent-dim)]">
                      {o.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
