import type { Prisma } from "@prisma/client";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

/** Характеристики, що виводяться на картці товару в списку (порядок = пріоритет). */
export const CARD_SPEC_SLUGS = ["area_m2", "area_range_m2", "power_w", "length_m", "power_w_m2", "power_w_m", "size_m"] as const;

/** Вибірка полів для ProductCard — одна на всі списки (розділ, мітка, бренд, схожі). */
export const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  nameUk: true,
  sku: true,
  priceUah: true,
  priceVisible: true,
  priceKitUah: true,
  priceUnit: true,
  shortDescription: true,
  brand: { select: { name: true, slug: true } },
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, altUk: true } },
  specs: {
    where: { definition: { slug: { in: [...CARD_SPEC_SLUGS] } } },
    select: { valueText: true, valueNumber: true, definition: { select: { slug: true, labelUk: true, unit: true } } },
  },
  // Бейджі на картці: лише «комплектація» (акція, під замовлення) — застосування є у фільтрах і на всіх картках розділу однакове
  tags: {
    where: { tag: { slug: { in: ["aktsiia", "pid-zamovlennia"] } } },
    select: { tag: { select: { slug: true, nameUk: true } } },
  },
} satisfies Prisma.ProductSelect;

export type ProductCardData = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>;

/** Коротка стрічка характеристик для картки: «Площа 1,5 м² · 225 Вт · 15 м». */
export function cardSpecs(specs: ProductCardData["specs"]): { label: string; value: string }[] {
  const by = new Map(specs.map((s) => [s.definition.slug, s]));
  const out: { label: string; value: string }[] = [];
  const fmt = (s: ProductCardData["specs"][number] | undefined) => {
    if (!s) return null;
    const v = s.valueNumber != null ? formatSpecNumber(s.valueNumber) : s.valueText;
    if (!v) return null;
    const unit = s.definition.unit;
    return unit && !v.includes(unit) ? `${v} ${unit}` : v;
  };
  const area = fmt(by.get("area_m2")) ?? fmt(by.get("area_range_m2"));
  if (area) out.push({ label: "Площа", value: area });
  const power = fmt(by.get("power_w"));
  if (power) out.push({ label: "Потужність", value: power });
  const len = fmt(by.get("length_m"));
  if (len) out.push({ label: "Довжина", value: len });
  if (out.length < 3) {
    const sp = fmt(by.get("power_w_m2")) ?? fmt(by.get("power_w_m"));
    if (sp) out.push({ label: "Питома", value: sp });
  }
  if (out.length < 3) {
    const size = fmt(by.get("size_m"));
    if (size) out.push({ label: "Розмір", value: size });
  }
  return out.slice(0, 3);
}

/** Число характеристики по-українськи: 1750 → «1750», 87.5 → «87,5», 0.75 → «0,75». */
export function formatSpecNumber(n: { toString(): string } | number): string {
  const x = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(x)) return String(n);
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2, useGrouping: false }).format(x);
}

export { PUBLIC_PRODUCT_WHERE };
