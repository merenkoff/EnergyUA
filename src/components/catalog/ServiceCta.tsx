import Link from "next/link";
import { SITE, phoneHref } from "@/lib/siteConfig";

/** Блок «Потрібен майстер»: оголошення сервісу на OLX + калькулятор і каталог. Використовується в статтях. */
export function ServiceCta({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`rounded-[var(--radius)] bg-[var(--foreground)] text-white shadow-[var(--shadow-md)] ${compact ? "p-5" : "p-7"}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">Монтаж і ремонт</p>
      <p className={`mt-2 font-bold ${compact ? "text-lg" : "text-2xl"}`}>Потрібен майстер у Києві чи області?</p>
      <p className="mt-3 text-sm leading-relaxed text-white/75">
        Діагностика з виїздом, ремонт кабелю через одну плитку, заміна терморегулятора, монтаж мату чи кабелю. Досвід 17 років,
        гарантія на роботи 2 роки.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {SITE.olx.map((o) => (
          <li key={o.href}>
            <a href={o.href} target="_blank" rel="noopener" className="font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
              {o.title} — оголошення на OLX
            </a>
          </li>
        ))}
        {SITE.phone ? (
          <li>
            <a href={phoneHref(SITE.phone)} className="text-lg font-semibold text-white">
              {SITE.phone}
            </a>
          </li>
        ) : null}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/calc" className="btn-primary !px-4 !py-2 text-sm">
          Підібрати за площею
        </Link>
        <Link href="/catalog" className="rounded-full border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
          Каталог
        </Link>
      </div>
    </aside>
  );
}
