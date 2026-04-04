import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© {new Date().getFullYear()} ElectroHeat. Каталог без онлайн-оплати — уточнення та замовлення за контактами пізніше.</p>
        <Link href="/catalog" className="text-[var(--accent)] hover:underline">
          Перейти в каталог
        </Link>
      </div>
    </footer>
  );
}
