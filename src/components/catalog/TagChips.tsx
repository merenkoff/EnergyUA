import Link from "next/link";

export type TagChip = { slug: string; nameUk: string; groupSlug: string | null; count?: number; active?: boolean };

/** Ряд міток-посилань. href будує викликач (сторінка мітки або фільтр у розділі). */
export function TagChips({ tags, hrefFor, size = "sm" }: { tags: TagChip[]; hrefFor: (t: TagChip) => string; size?: "sm" | "xs" }) {
  if (!tags.length) return null;
  const pad = size === "xs" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]";
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <Link
          key={t.slug}
          href={hrefFor(t)}
          className={`inline-flex items-center gap-1.5 rounded-full border ${pad} font-medium transition ${
            t.active
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_2px_8px_rgba(226,71,42,0.25)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent-dim)]"
          }`}
        >
          {t.nameUk}
          {t.count != null ? <span className={`text-[11px] ${t.active ? "opacity-80" : "text-[var(--muted-2)]"}`}>{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
