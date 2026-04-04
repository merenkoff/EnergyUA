import Link from "next/link";
import { resolveMatsCatalogHref } from "@/lib/catalogLinks";

export async function SiteHeader() {
  const matsHref = await resolveMatsCatalogHref();

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 font-semibold tracking-tight text-[var(--foreground)]">
          <span className="text-lg">ElectroHeat</span>
          <span className="hidden text-xs font-normal text-[var(--muted)] sm:inline">електрична тепла підлога</span>
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-1 text-sm sm:gap-4">
          <Link
            href="/catalog"
            className="rounded-md px-2 py-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] sm:px-3"
          >
            Каталог
          </Link>
          {matsHref ? (
            <Link
              href={matsHref}
              className="rounded-md px-2 py-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] sm:px-3"
            >
              Мати
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
