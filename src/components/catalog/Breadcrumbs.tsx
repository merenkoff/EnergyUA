import Link from "next/link";

export type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Навігація" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--muted)]">
      {items.map((b, i) => (
        <span key={`${b.label}-${i}`} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden className="text-[var(--muted-2)]">/</span> : null}
          {b.href && i < items.length - 1 ? (
            <Link href={b.href} className="hover:text-[var(--accent-dim)]">
              {b.label}
            </Link>
          ) : (
            <span className="text-[var(--foreground)]">{b.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
