import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic-ext"],
});

/** Без цього `next build` викликає Prisma з layout (шапка) під час пререндеру — на Railway Build часто немає DATABASE_URL. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "ElectroHeat — електрична тепла підлога",
    template: "%s · ElectroHeat",
  },
  description: "Каталог електричної теплої підлоги: мати, кабелі, комплектація. Підбір і консультація.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
