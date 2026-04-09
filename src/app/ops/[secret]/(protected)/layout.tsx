import Link from "next/link";
import { requireAdminSession } from "@/lib/adminAuth";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

export default async function AdminProtectedLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ secret: string }>;
}>) {
  const { secret } = await params;
  await requireAdminSession(secret);

  return (
    <>
      <header className="mb-8 flex flex-col gap-3 border-b border-zinc-700/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Адмінка</span>
          <Link href={`/ops/${secret}/products`} className="text-emerald-400 hover:underline">
            Каталог товарів
          </Link>
          <Link href={`/ops/${secret}/categories`} className="text-emerald-400 hover:underline">
            Категорії
          </Link>
          <Link href="/catalog" className="text-zinc-400 hover:text-zinc-200">
            Публічний сайт
          </Link>
        </div>
        <AdminLogoutButton routeSecret={secret} />
      </header>
      {children}
    </>
  );
}
