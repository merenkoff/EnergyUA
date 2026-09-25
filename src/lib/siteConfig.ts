/**
 * Назва сайту й контакти. Порожні значення просто не показуються (логотип, телефон і пошта — пізніше).
 * Змінювати тут; шапка, футер, головна і мета-теги читають звідси.
 */
export const SITE = {
  name: "ТеплоКабель",
  tagline: "електрична тепла підлога та обігрів",
  description:
    "Каталог електричної теплої підлоги: нагрівальні мати й кабель Hemstedt, Fenix, Nexans, Arnold Rak, Magnum, терморегулятори, антиобледеніння — за актуальними прайсами постачальників.",
  phone: process.env.NEXT_PUBLIC_SITE_PHONE ?? "",
  email: process.env.NEXT_PUBLIC_SITE_EMAIL ?? "",
  city: "Київ, доставка по Україні",
  workHours: "Пн–Пт 9:00–18:00",
} as const;

/** tel: без пробілів і дужок. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
