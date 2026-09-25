import Link from "next/link";
import type { TagChip } from "@/components/catalog/TagChips";

/** Бічна панель фільтрів розділу: групи міток з кількістю; активні — підсвічені. */
export function TagFilterSidebar({
  groups,
  activeTags,
  hrefFor,
  resetHref,
}: {
  groups: [label: string, chips: TagChip[]][];
  activeTags: string[];
  hrefFor: (t: TagChip) => string;
  resetHref: string;
}) {
  return (
    <aside className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)] lg:sticky lg:top-[120px]">
      {/* На мобільному список згорнутий (details), на десктопі — завжди розкритий */}
      <details className="group/f lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold uppercase tracking-[0.1em] text-[var(--foreground)]">
          Фільтри{activeTags.length ? ` (${activeTags.length})` : ""}
          <span className="text-[var(--muted-2)] transition group-open/f:rotate-180">⌄</span>
        </summary>
        <Groups groups={groups} activeTags={activeTags} hrefFor={hrefFor} resetHref={resetHref} />
      </details>
      <div className="hidden lg:block">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--foreground)]">Фільтри</h2>
          {activeTags.length ? (
            <Link href={resetHref} className="text-xs font-medium text-[var(--accent-dim)] hover:underline">
              Скинути ({activeTags.length})
            </Link>
          ) : null}
        </div>
        <Groups groups={groups} activeTags={activeTags} hrefFor={hrefFor} resetHref={resetHref} />
      </div>
    </aside>
  );
}

function Groups({
  groups,
  activeTags,
  hrefFor,
  resetHref,
}: {
  groups: [label: string, chips: TagChip[]][];
  activeTags: string[];
  hrefFor: (t: TagChip) => string;
  resetHref: string;
}) {
  return (
    <>
      {activeTags.length ? (
        <Link href={resetHref} className="mt-2 inline-block text-xs font-medium text-[var(--accent-dim)] hover:underline lg:hidden">
          Скинути фільтри
        </Link>
      ) : null}
      <div className="mt-3 divide-y divide-[var(--border)]">
        {groups.map(([label, chips]) => (
          <details key={label} open className="group py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-[var(--foreground)]">
              {label}
              <span className="text-[var(--muted-2)] transition group-open:rotate-180">⌄</span>
            </summary>
            <ul className="mt-2 space-y-1">
              {chips.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={hrefFor(t)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] transition ${
                      t.active ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-dim)]" : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                          t.active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)] bg-[var(--surface)]"
                        }`}
                      >
                        {t.active ? "✓" : ""}
                      </span>
                      {t.nameUk}
                    </span>
                    {t.count != null ? <span className="text-[11px] text-[var(--muted-2)]">{t.count}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}
