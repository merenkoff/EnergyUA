import slugify from "slugify";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeNameKey } from "./productDuplicateSimilarity";
import type { UnifiedProduct } from "../parsers/types";

export function specSlug(label: string): string {
  const s = slugify(label, { lower: true, strict: true, locale: "uk" });
  return s.slice(0, 80) || "spec";
}

export function parseSpecNumber(value: string): { num?: Prisma.Decimal; text: string } {
  const t = value.trim();
  const simple = t.match(/^\s*([\d]+(?:[.,][\d]+)?)\s*$/);
  if (simple) {
    const n = parseFloat(simple[1].replace(",", "."));
    if (Number.isFinite(n) && Math.abs(n) < 1e12) {
      return { num: new Prisma.Decimal(n), text: t };
    }
  }
  return { text: t };
}

export async function upsertProductSpecs(
  prisma: PrismaClient,
  productId: string,
  specs: UnifiedProduct["specs"],
) {
  let order = 100;
  for (const row of specs) {
    const slug = specSlug(row.label);
    const def = await prisma.specDefinition.upsert({
      where: { slug },
      create: {
        slug,
        labelUk: row.label.trim(),
        groupSlug: row.group ? slugify(row.group, { lower: true, strict: true, locale: "uk" }).slice(0, 60) : null,
        filterable: /м²|м2|вт|w/i.test(row.label),
        sortOrder: order++,
      },
      update: { labelUk: row.label.trim() },
    });

    const { num, text } = parseSpecNumber(row.value);
    await prisma.productSpec.upsert({
      where: {
        productId_definitionId: { productId, definitionId: def.id },
      },
      create: {
        productId,
        definitionId: def.id,
        valueText: text,
        valueNumber: num ?? null,
      },
      update: {
        valueText: text,
        valueNumber: num ?? null,
      },
    });
  }
}

/** Глобально унікальний slug товару при імпорті. */
export function importProductSlug(p: UnifiedProduct): string {
  const safeId = p.externalId.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  const s = `${p.source}-${safeId}`.replace(/^-|-$/g, "").slice(0, 200);
  return s || `import-${p.source}-${Date.now()}`;
}

/**
 * SKU в БД унікальний глобально; на маркетах один «Код» може повторюватися між різними картками.
 * Зберігаємо код + зовнішній id, щоб не порушувати unique.
 */
export function importProductSku(p: UnifiedProduct): string | null {
  const code = p.sku?.trim();
  const ext = p.externalId.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  if (code) {
    const s = `${code}__${p.source}__${ext}`.replace(/^-|-$/g, "");
    return s.slice(0, 120) || null;
  }
  return null;
}

export async function importUnifiedProduct(
  prisma: PrismaClient,
  p: UnifiedProduct,
  categoryId: string,
  publish: boolean,
) {
  const extSource = p.source;
  const extId = p.externalId;
  const slug = importProductSlug(p);

  const sku = importProductSku(p);
  const nameNormKey = normalizeNameKey(p.nameUk) || null;

  const product = await prisma.product.upsert({
    where: {
      externalSource_externalId: { externalSource: extSource, externalId: extId },
    },
    create: {
      slug,
      sku,
      nameUk: p.nameUk,
      nameNormKey,
      shortDescription: p.shortDescription ?? null,
      description: p.descriptionHtml ?? null,
      priceUah: p.priceUah != null ? new Prisma.Decimal(p.priceUah) : null,
      priceVisible: p.priceVisible,
      categoryId,
      published: publish,
      externalSource: extSource,
      externalId: extId,
      externalUrl: p.sourceUrl?.trim() || null,
      sourceCategoryUrl: p.sourceCategoryUrl?.trim() || null,
      seoTitle: p.nameUk.slice(0, 200),
    },
    update: {
      slug,
      nameUk: p.nameUk,
      nameNormKey,
      sku: sku ?? undefined,
      shortDescription: p.shortDescription ?? undefined,
      description: p.descriptionHtml ?? undefined,
      priceUah: p.priceUah != null ? new Prisma.Decimal(p.priceUah) : undefined,
      priceVisible: p.priceVisible,
      published: publish,
      categoryId,
      externalUrl: p.sourceUrl?.trim() || undefined,
      sourceCategoryUrl: p.sourceCategoryUrl?.trim() ?? undefined,
    },
  });

  await prisma.productImage.deleteMany({ where: { productId: product.id } });
  let sort = 0;
  for (const img of p.images) {
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: img.url,
        altUk: img.alt ?? null,
        sortOrder: sort++,
      },
    });
  }

  await prisma.productSpec.deleteMany({ where: { productId: product.id } });
  if (p.specs.length) await upsertProductSpecs(prisma, product.id, p.specs);
}
