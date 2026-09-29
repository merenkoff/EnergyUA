/**
 * Назва сайту й контакти. Порожні значення просто не показуються (логотип, телефон і пошта — пізніше).
 * Змінювати тут; шапка, футер, головна і мета-теги читають звідси.
 */
export const SITE = {
  name: "Є-тепло",
  tagline: "тепла підлога · електрообігрів",
  description:
    "Каталог електричної теплої підлоги: нагрівальні мати й кабель Hemstedt, Fenix, Nexans, Arnold Rak, Magnum, терморегулятори, антиобледеніння — за актуальними прайсами постачальників.",
  phone: process.env.NEXT_PUBLIC_SITE_PHONE ?? "",
  email: process.env.NEXT_PUBLIC_SITE_EMAIL ?? "",
  city: "Київ, доставка по Україні",
  workHours: "Пн–Пт 9:00–18:00",
  /** Канонічна адреса сайту для sitemap, canonical і JSON-LD; без домену — відносні URL. */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""),
  /** SITE_NOINDEX=1 — закрити сайт від індексації, поки він на тимчасовому домені. */
  noindex: process.env.SITE_NOINDEX === "1",
  /** Оголошення сервісу (монтаж і ремонт) на OLX — посилання зі статей і блоку «Потрібен майстер». */
  olx: [
    { title: "Ремонт теплої підлоги будь-якої складності, монтаж", href: "https://www.olx.ua/d/uk/obyavlenie/remont-teplyh-polov-teplogo-pola-lyuboy-slozhnosti-montazh-d-ID5bnkj.html" },
    { title: "Ремонт, монтаж, сервіс теплих підлог", href: "https://www.olx.ua/d/uk/obyavlenie/remont-montazh-servis-teplyh-polov-remont-teplih-pdlog-IDVard6.html" },
  ],
} as const;

/** tel: без пробілів і дужок. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
