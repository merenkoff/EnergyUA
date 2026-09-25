import Link from "next/link";
import { SITE } from "@/lib/siteConfig";

/** Текстовий логотип-заглушка: знак «хвиля тепла» + назва. Справжній логотип додамо пізніше — замінити лише тут. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={SITE.name}>
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_4px_12px_rgba(226,71,42,0.3)]"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15c2-3 4-3 6 0s4 3 6 0 4-3 4 0" />
          <path d="M4 9c2-3 4-3 6 0s4 3 6 0 4-3 4 0" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[1.15rem] font-bold tracking-tight text-[var(--foreground)]">
          Тепло<span className="text-[var(--accent)]">Кабель</span>
        </span>
        {!compact ? <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-2)]">{SITE.tagline}</span> : null}
      </span>
    </Link>
  );
}
