import { notFound } from "next/navigation";
import { getAdminRouteSecret, isAdminConfigured } from "@/lib/adminAuth";

export const metadata = {
  robots: { index: false, follow: false },
  title: { template: "%s · Admin", default: "Admin" },
};

export default async function OpsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ secret: string }>;
}>) {
  const { secret } = await params;
  const expected = getAdminRouteSecret();
  if (!isAdminConfigured() || !expected || secret !== expected) notFound();
  return (
    <div className="min-h-[70vh] border-t border-zinc-800 bg-[#0c0e12] text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
