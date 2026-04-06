import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { getAdminSessionCookie, getAdminRouteSecret, verifyAdminSessionToken } from "@/lib/adminAuth";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Вхід",
};

export default async function AdminLoginPage({ params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (secret !== getAdminRouteSecret()) redirect("/");

  const tok = await getAdminSessionCookie();
  if (verifyAdminSessionToken(tok)) {
    redirect(`/ops/${secret}/products`);
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-xl font-semibold text-zinc-100">Адмін-панель</h1>
      <p className="mb-6 text-sm text-zinc-500">Введіть пароль. Цей URL не показуйте в публічному меню.</p>
      <AdminLoginForm routeSecret={secret} />
    </div>
  );
}
