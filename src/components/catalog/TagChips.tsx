import Link from "next/link";

export type TagChip = { slug: string; nameUk: string; groupSlug: string | null; count?: number; active?: boolean };

/** Ряд міток-посилань. href будує викликач (сторінка мітки або фільтр у розділі). */
export function TagChips({ tags, hrefFor, size = "sm" }: { tags: TagChip[]; hrefFor: (t: TagChip) => string; size?: "sm" | "xs" }) {
  if (!tags.length) return null;
  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <Link
          key={t.slug}
          href={hrefFor(t)}
          className={`inline-flex items-center gap-1 rounded-full border ${pad} font-medium transition ${
            t.active
              ? "border-[var(--accent)] bg-[var(--accent)] text-[#0c0f14]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]/60 hover:text-[var(--foreground)]"
          }`}
        >
          {t.nameUk}
          {t.count != null ? <span className={t.active ? "opacity-70" : "text-[var(--muted)]/70"}>{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
