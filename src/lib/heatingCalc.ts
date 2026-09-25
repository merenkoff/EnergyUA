import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CARD_SELECT, type ProductCardData } from "@/lib/productCard";
import { PUBLIC_PRODUCT_WHERE } from "@/lib/publicCatalog";

/**
 * Калькулятор підбору теплої підлоги: площа + покриття + тип приміщення → питома потужність →
 * мати / кабель з каталогу, які підходять за площею (мат) або за потужністю й кроком укладання (кабель).
 * Нормативи питомої потужності — типові рекомендації виробників (Hemstedt, Fenix, Nexans, Magnum):
 * комфортний підігрів 120–150 Вт/м², вологі приміщення 150–180, балкон/основне опалення 180–220,
 * під ламінат — не більше 150–160 Вт/м².
 */

export type Covering = "tile" | "laminate" | "screed";
export type Room = "living" | "wet" | "balcony" | "main";

export const COVERINGS: { value: Covering; label: string; hint: string }[] = [
  { value: "tile", label: "Плитка, камінь, керамограніт", hint: "мат або тонкий кабель у плитковий клей" },
  { value: "laminate", label: "Ламінат, паркетна дошка, вініл", hint: "алюмінієвий мат або мат у фользі, без стяжки" },
  { value: "screed", label: "Стяжка (будь-яке покриття зверху)", hint: "класичний кабель у стяжку 3–6 см" },
];

export const ROOMS: { value: Room; label: string; hint: string }[] = [
  { value: "living", label: "Житлова кімната, коридор", hint: "комфортний підігрів" },
  { value: "wet", label: "Ванна, кухня, санвузол", hint: "вологе приміщення, вища потужність" },
  { value: "balcony", label: "Балкон, лоджія, веранда", hint: "великі тепловтрати" },
  { value: "main", label: "Основне опалення", hint: "тепла підлога — єдине джерело тепла" },
];

export type CalcInput = { area: number; covering: Covering; room: Room };

/** Рекомендована питома потужність, Вт/м²: min…max, target — на що орієнтуємось. */
export function targetDensity(covering: Covering, room: Room): { min: number; target: number; max: number } {
  const base: Record<Room, [number, number, number]> = {
    living: [120, 150, 170],
    wet: [150, 180, 200],
    balcony: [180, 200, 220],
    main: [180, 200, 220],
  };
  const [min, target, max] = base[room];
  if (covering === "laminate") {
    // Під ламінат/паркет виробники обмежують 150–160 Вт/м²
    return { min: Math.min(min, 110), target: Math.min(target, 150), max: Math.min(max, 160) };
  }
  if (covering === "screed") return { min: min - 10, target: target - 10, max };
  return { min, target, max };
}

export type CalcMat = { product: ProductCardData; coverArea: number; density: number; power: number; score: number };
export type CalcCable = { product: ProductCardData; power: number; length: number; density: number; stepCm: number; score: number };

export type CalcResult = {
  input: CalcInput;
  density: { min: number; target: number; max: number };
  neededPower: number;
  mats: CalcMat[];
  cables: CalcCable[];
  thermostats: ProductCardData[];
};

const CALC_SPEC_SLUGS = ["area_m2", "area_range_m2", "power_w", "length_m", "power_w_m2", "power_w_m", "size_m"];
const CALC_SELECT = {
  ...PRODUCT_CARD_SELECT,
  specs: {
    where: { definition: { slug: { in: CALC_SPEC_SLUGS } } },
    select: { valueText: true, valueNumber: true, definition: { select: { slug: true, labelUk: true, unit: true } } },
  },
} satisfies Prisma.ProductSelect;

function num(specs: ProductCardData["specs"], slug: string): number | null {
  const s = specs.find((x) => x.definition.slug === slug);
  if (!s) return null;
  if (s.valueNumber != null) return Number(s.valueNumber.toString());
  if (s.valueText) {
    const m = s.valueText.replace(",", ".").match(/[\d.]+/);
    if (m) return Number(m[0]);
  }
  return null;
}

/** Мати: підходять, якщо площа мату ≤ вільної площі (мат не ріжуть) і не менша за ~80 % від неї. */
function pickMats(products: ProductCardData[], input: CalcInput, d: { min: number; target: number; max: number }): CalcMat[] {
  const out: CalcMat[] = [];
  for (const p of products) {
    const area = num(p.specs, "area_m2");
    const power = num(p.specs, "power_w");
    if (!area || !power) continue;
    if (area > input.area * 1.02 || area < input.area * 0.78) continue;
    const density = num(p.specs, "power_w_m2") ?? power / area;
    if (density < d.min - 25 || density > d.max + 25) continue;
    const score = (Math.abs(area - input.area) / input.area) * 2 + Math.abs(density - d.target) / d.target;
    out.push({ product: p, coverArea: area, density: Math.round(density), power, score });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** Кабель: потрібна потужність = площа × питома; перевіряємо крок укладання (площа / довжина). */
function pickCables(products: ProductCardData[], input: CalcInput, d: { min: number; target: number; max: number }, step: [number, number]): CalcCable[] {
  const out: CalcCable[] = [];
  for (const p of products) {
    const power = num(p.specs, "power_w");
    const length = num(p.specs, "length_m");
    if (!power || !length) continue;
    const density = power / input.area;
    if (density < d.min * 0.92 || density > d.max * 1.08) continue;
    const stepM = input.area / length;
    if (stepM < step[0] || stepM > step[1]) continue;
    const score = Math.abs(density - d.target) / d.target;
    out.push({ product: p, power, length, density: Math.round(density), stepCm: Math.round(stepM * 100 * 2) / 2, score });
  }
  return out.sort((a, b) => a.score - b.score);
}

export async function calculate(input: CalcInput): Promise<CalcResult> {
  const d = targetDensity(input.covering, input.room);
  const neededPower = Math.round(input.area * d.target);
  const base = { ...PUBLIC_PRODUCT_WHERE, priceUah: { not: null } };

  let mats: CalcMat[] = [];
  let cables: CalcCable[] = [];

  if (input.covering === "tile") {
    const [matRows, cableRows] = await Promise.all([
      prisma.product.findMany({ where: { ...base, category: { slug: "nahrivalni-maty" } }, select: CALC_SELECT }),
      prisma.product.findMany({
        where: { ...base, category: { slug: "nahrivalnyi-kabel" }, tags: { some: { tag: { slug: { in: ["tonkyi-kabel", "ultratonkyi", "pid-plytku"] } } } } },
        select: CALC_SELECT,
      }),
    ]);
    mats = pickMats(matRows, input, d);
    cables = pickCables(cableRows, input, d, [0.05, 0.12]);
  } else if (input.covering === "laminate") {
    const rows = await prisma.product.findMany({ where: { ...base, category: { slug: "pid-laminat" } }, select: CALC_SELECT });
    mats = pickMats(rows, input, d);
  } else {
    const rows = await prisma.product.findMany({
      where: { ...base, category: { slug: "nahrivalnyi-kabel" }, tags: { some: { tag: { slug: "u-stiazhku" } } } },
      select: CALC_SELECT,
    });
    cables = pickCables(rows, input, d, [0.07, 0.2]);
  }

  // Термостати: по одному механічному, програмованому та Wi-Fi з датчиком підлоги — найдешевші
  const thermostats = (
    await Promise.all(
      ["mekhanichnyi", "prohramovanyi", "wi-fi"].map((slug) =>
        prisma.product.findFirst({
          where: { ...base, category: { slug: "termorehuliatory" }, images: { some: {} }, tags: { some: { tag: { slug } } } },
          orderBy: { priceUah: "asc" },
          select: PRODUCT_CARD_SELECT,
        }),
      ),
    )
  ).filter((t): t is ProductCardData => Boolean(t));
  const seen = new Set<string>();
  const uniqThermostats = thermostats.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

  return { input, density: d, neededPower, mats: mats.slice(0, 6), cables: cables.slice(0, 6), thermostats: uniqThermostats };
}

/** Розбір параметрів запиту; null — форма ще не заповнена або значення поза межами. */
export function parseCalcInput(sp: { area?: string; covering?: string; room?: string }): CalcInput | null {
  const area = Number(String(sp.area ?? "").replace(",", "."));
  if (!Number.isFinite(area) || area < 0.3 || area > 200) return null;
  const covering = COVERINGS.find((c) => c.value === sp.covering)?.value ?? "tile";
  const room = ROOMS.find((r) => r.value === sp.room)?.value ?? "living";
  return { area: Math.round(area * 10) / 10, covering, room };
}
