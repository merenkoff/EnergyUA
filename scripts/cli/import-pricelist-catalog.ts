/**
 * Імпорт нового каталогу з файлів товарів data/catalog/<постачальник>/<sku>.json у БД.
 *
 *   npx tsx scripts/cli/import-pricelist-catalog.ts            # усі
 *   npx tsx scripts/cli/import-pricelist-catalog.ts --only rd  # один постачальник
 *   npx tsx scripts/cli/import-pricelist-catalog.ts --dry-run  # лише перевірка файлів
 *
 * Ідемпотентно: ключ товару externalSource = "pricelist", externalId = <supplier>/<sku-slug>.
 * Створює/оновлює категорії-розділи, мітки, бренди, характеристики. Товари, яких у файлах
 * більше немає, знімаються з публікації (published = false), але не видаляються.
 * Запускається на кожному деплої (npm run db:predeploy) після prisma db seed.
 */
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { getMediaRoot, isSafeMediaFilename } from "../../src/lib/mediaStorage";
import { ensureCatalogStructure } from "../lib/catalogStructure";
import type { PricelistProduct } from "../lib/pricelistProduct";
import { BRAND_SLUGS, PRICELIST_SOURCE, SECTION_SLUGS, TAG_SLUGS } from "../lib/pricelistTaxonomy";
import { normalizeNameKey } from "../lib/productDuplicateSimilarity";

const prisma = new PrismaClient();
const CATALOG_DIR = path.resolve(process.cwd(), "data/catalog");
const MEDIA_DIR = path.resolve(process.cwd(), "data/catalog-media");
/** sourceUrl рядків product_images, які створює цей імпорт (щоб не чіпати фото, завантажені в адмінці). */
const IMAGE_SOURCE_PREFIX = "pricelist:";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readProducts(only?: string): PricelistProduct[] {
  const out: PricelistProduct[] = [];
  const errors: string[] = [];
  for (const supplier of fs.readdirSync(CATALOG_DIR).sort()) {
    const dir = path.join(CATALOG_DIR, supplier);
    if (!fs.statSync(dir).isDirectory() || (only && supplier !== only)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      const p = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as PricelistProduct;
      const where = `${supplier}/${file}`;
      if (p.id !== `${supplier}/${file.replace(/\.json$/, "")}`) errors.push(`${where}: id ${p.id} не збігається з ім'ям файлу`);
      if (!SECTION_SLUGS.has(p.category)) errors.push(`${where}: невідомий розділ ${p.category}`);
      if (p.brand && !BRAND_SLUGS.has(p.brand)) errors.push(`${where}: невідомий бренд ${p.brand}`);
      for (const t of p.tags) if (!TAG_SLUGS.has(t)) errors.push(`${where}: невідома мітка ${t}`);
      if (!p.nameUk?.trim()) errors.push(`${where}: порожня назва`);
      for (const im of p.images ?? []) {
        if (!isSafeMediaFilename(im.file)) errors.push(`${where}: некоректне ім'я файлу фото ${im.file}`);
        else if (!fs.existsSync(path.join(MEDIA_DIR, im.file))) errors.push(`${where}: немає файлу data/catalog-media/${im.file}`);
      }
      out.push(p);
    }
  }
  if (errors.length) {
    for (const e of errors) console.error("  ! " + e);
    throw new Error(`Файли товарів не пройшли перевірку: ${errors.length} помилок`);
  }
  return out;
}

/**
 * Копіює фото з data/catalog-media у MEDIA_ROOT, якщо папка існує (локально — storage/media, створюємо).
 * На Railway у pre-deploy volume не змонтований, тому там копіює railway-entrypoint.sh при старті.
 */
function copyMediaToRoot(): void {
  const root = getMediaRoot();
  const isLocalDefault = !process.env.MEDIA_ROOT?.trim();
  if (!fs.existsSync(root)) {
    if (!isLocalDefault) {
      console.error(`[import-pricelists] MEDIA_ROOT ${root} недоступний — фото скопіює entrypoint при старті`);
      return;
    }
    fs.mkdirSync(root, { recursive: true });
  }
  let copied = 0;
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    if (!isSafeMediaFilename(f)) continue;
    const dst = path.join(root, f);
    if (fs.existsSync(dst)) continue;
    fs.copyFileSync(path.join(MEDIA_DIR, f), dst);
    copied++;
  }
  console.error(`[import-pricelists] фото в ${root}: скопійовано ${copied} нових`);
}

function productSlug(p: PricelistProduct): string {
  return p.id.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 200);
}

async function main() {
  const only = arg("--only");
  const dry = process.argv.includes("--dry-run");
  const products = readProducts(only);
  console.error(`[import-pricelists] файлів товарів: ${products.length}${only ? ` (лише ${only})` : ""}`);
  if (dry) return;

  const structure = await ensureCatalogStructure(prisma);

  // Кеш визначень характеристик: slug → id
  const specDefs = new Map<string, string>();
  for (const d of await prisma.specDefinition.findMany({ select: { id: true, slug: true } })) specDefs.set(d.slug, d.id);
  let specOrder = 1000;
  async function specDefId(slug: string, labelUk: string, unit: string | null | undefined): Promise<string> {
    const cached = specDefs.get(slug);
    if (cached) return cached;
    const row = await prisma.specDefinition.upsert({
      where: { slug },
      create: { slug, labelUk, unit: unit ?? null, groupSlug: "pricelist", filterable: /^(power_w|power_w_m2|power_w_m|area_m2|length_m|max_load_a)$/.test(slug), sortOrder: specOrder++ },
      update: {},
      select: { id: true },
    });
    specDefs.set(slug, row.id);
    return row.id;
  }

  // SKU унікальний глобально: однаковий артикул у двох постачальників → суфікс з ключем прайсу.
  const existingSku = new Map<string, string>(); // sku → externalId
  for (const r of await prisma.product.findMany({ where: { sku: { not: null } }, select: { sku: true, externalId: true, externalSource: true } })) {
    existingSku.set(r.sku!, r.externalSource === PRICELIST_SOURCE ? (r.externalId ?? "") : "__other__");
  }

  const seenIds = new Set<string>();
  let created = 0;
  let updated = 0;
  const perCategoryOrder = new Map<string, number>();

  for (const p of products) {
    seenIds.add(p.id);
    const categoryId = structure.sections.get(p.category)!;
    const brandId = p.brand ? structure.brands.get(p.brand) ?? null : null;
    let sku = p.sku;
    const holder = existingSku.get(sku);
    if (holder !== undefined && holder !== p.id) sku = `${p.sku} [${p.supplier}]`;
    existingSku.set(sku, p.id);
    const sortOrder = (perCategoryOrder.get(p.category) ?? 0) + 10;
    perCategoryOrder.set(p.category, sortOrder);

    const data = {
      sku,
      nameUk: p.nameUk,
      nameNormKey: normalizeNameKey(p.nameUk) || null,
      shortDescription: p.shortDescription ?? null,
      description: p.description ?? null,
      priceUah: p.priceUah != null ? new Prisma.Decimal(p.priceUah) : null,
      priceVisible: p.priceUah != null,
      priceKitUah: p.priceKitUah != null ? new Prisma.Decimal(p.priceKitUah) : null,
      priceUnit: p.priceUnit ?? null,
      priceNote: p.priceNote ?? null,
      categoryId,
      brandId,
      published: true,
      archived: false,
      sortOrder,
      seoTitle: p.nameUk.slice(0, 200),
      externalUrl: null,
      sourceCategoryUrl: `${p.source.file}${p.source.sheet ? `#${p.source.sheet}` : ""}`,
    };

    const existing = await prisma.product.findUnique({
      where: { externalSource_externalId: { externalSource: PRICELIST_SOURCE, externalId: p.id } },
      select: { id: true, tagsManual: true },
    });
    let productId: string;
    let tagsManual = false;
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
      productId = existing.id;
      tagsManual = existing.tagsManual;
      updated++;
    } else {
      let slug = productSlug(p);
      if (await prisma.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${Date.now().toString(36)}`;
      const row = await prisma.product.create({
        data: { ...data, slug, externalSource: PRICELIST_SOURCE, externalId: p.id },
        select: { id: true },
      });
      productId = row.id;
      created++;
    }

    // Характеристики — повна заміна
    const specRows: Prisma.ProductSpecCreateManyInput[] = [];
    const usedDefs = new Set<string>();
    for (const s of p.specs) {
      const defId = await specDefId(s.slug, s.labelUk, s.unit);
      if (usedDefs.has(defId)) continue;
      usedDefs.add(defId);
      specRows.push({
        productId,
        definitionId: defId,
        valueText: s.value,
        valueNumber: s.number != null && Number.isFinite(s.number) ? new Prisma.Decimal(s.number) : null,
      });
    }
    await prisma.productSpec.deleteMany({ where: { productId } });
    if (specRows.length) await prisma.productSpec.createMany({ data: specRows });

    // Фото з прайсу — заміна лише рядків цього імпорту (адмінські завантаження лишаються)
    const wantImages = (p.images ?? []).map((im, i) => ({ url: `/api/media/${im.file}`, sourceUrl: IMAGE_SOURCE_PREFIX + im.file, altUk: im.alt ?? p.nameUk, sortOrder: i }));
    const haveImages = await prisma.productImage.findMany({
      where: { productId, sourceUrl: { startsWith: IMAGE_SOURCE_PREFIX } },
      select: { id: true, url: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    const same = haveImages.length === wantImages.length && haveImages.every((h, i) => h.url === wantImages[i].url && h.sortOrder === wantImages[i].sortOrder);
    if (!same) {
      await prisma.productImage.deleteMany({ where: { productId, sourceUrl: { startsWith: IMAGE_SOURCE_PREFIX } } });
      if (wantImages.length) await prisma.productImage.createMany({ data: wantImages.map((im) => ({ productId, ...im })) });
    }

    // Мітки — повна заміна з прайсу, якщо їх не редагували в адмінці (tagsManual)
    if (!tagsManual) {
      const tagIds = p.tags.map((t) => structure.tags.get(t)!).filter(Boolean);
      await prisma.productTag.deleteMany({ where: { productId, tagId: { notIn: tagIds } } });
      if (tagIds.length) {
        await prisma.productTag.createMany({ data: tagIds.map((tagId) => ({ productId, tagId })), skipDuplicates: true });
      }
    }
  }

  // Товари прайсів, яких більше немає у файлах — знімаємо з публікації
  const stale = await prisma.product.findMany({
    where: { externalSource: PRICELIST_SOURCE, published: true, ...(only ? { externalId: { startsWith: `${only}/` } } : {}) },
    select: { id: true, externalId: true },
  });
  const staleIds = stale.filter((s) => !seenIds.has(s.externalId ?? "")).map((s) => s.id);
  if (staleIds.length) {
    await prisma.product.updateMany({ where: { id: { in: staleIds } }, data: { published: false } });
  }

  console.error(`[import-pricelists] створено ${created}, оновлено ${updated}, знято з публікації ${staleIds.length}`);
  copyMediaToRoot();
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
