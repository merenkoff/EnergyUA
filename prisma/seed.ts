/**
 * Seed виконується на кожному деплої (npm run db:predeploy), тому лише ідемпотентні upsert-и:
 *  - структура каталогу: корінь «Каталог» з розділами, корінь «Архів» (старий tepla-pidloga — під ним),
 *    мітки та бренди з scripts/lib/pricelistTaxonomy.ts;
 *  - базові визначення характеристик;
 *  - два демо-товари під старим коренем — архівні (на сайті не показуються).
 * Самі товари з прайсів імпортує scripts/cli/import-pricelist-catalog.ts одразу після seed.
 */
import { PrismaClient } from "@prisma/client";
import { ensureCatalogStructure } from "../scripts/lib/catalogStructure";
import { LEGACY_ROOT_SLUG } from "../scripts/lib/pricelistTaxonomy";
import { normalizeNameKey } from "../scripts/lib/productDuplicateSimilarity";

const prisma = new PrismaClient();

async function main() {
  const legacyRoot = await prisma.category.upsert({
    where: { slug: LEGACY_ROOT_SLUG },
    create: {
      slug: LEGACY_ROOT_SLUG,
      nameUk: "Тепла підлога (старий каталог)",
      nameRu: "Тёплый пол (старый каталог)",
      description: "Розділи, зібрані з сайтів-донорів. Зберігаються в архіві.",
      sortOrder: 0,
    },
    update: {},
  });

  // Переносить tepla-pidloga під «Архів», створює «Каталог» з розділами, мітки й бренди.
  await ensureCatalogStructure(prisma);

  const mats = await prisma.category.upsert({
    where: { slug: "nagrivalni-maty" },
    create: {
      slug: "nagrivalni-maty",
      nameUk: "Нагрівальні мати",
      nameRu: "Нагревательные маты",
      parentId: legacyRoot.id,
      sortOrder: 10,
    },
    update: { parentId: legacyRoot.id },
  });

  await prisma.category.upsert({
    where: { slug: "griuchi-kabeli" },
    create: {
      slug: "griuchi-kabeli",
      nameUk: "Гріючі кабелі",
      nameRu: "Греющие кабели",
      parentId: legacyRoot.id,
      sortOrder: 20,
    },
    update: { parentId: legacyRoot.id },
  });

  const brand = await prisma.brand.upsert({
    where: { slug: "demo-heat" },
    create: { slug: "demo-heat", name: "ElectroHeat Demo" },
    update: {},
  });

  const area = await prisma.specDefinition.upsert({
    where: { slug: "area_m2" },
    create: { slug: "area_m2", labelUk: "Площа обігріву", unit: "м²", groupSlug: "dimensions", filterable: true, sortOrder: 10 },
    update: { filterable: true },
  });

  const power = await prisma.specDefinition.upsert({
    where: { slug: "power_w_m2" },
    create: { slug: "power_w_m2", labelUk: "Питома потужність", unit: "Вт/м²", groupSlug: "electrical", filterable: true, sortOrder: 20 },
    update: {},
  });

  const voltage = await prisma.specDefinition.upsert({
    where: { slug: "voltage_v" },
    create: { slug: "voltage_v", labelUk: "Напруга", unit: "В", groupSlug: "electrical", filterable: true, sortOrder: 30 },
    update: {},
  });

  const demo = [
    { slug: "demo-mat-2-0", sku: "EH-DEMO-200", name: "Нагрівальний мат ElectroHeat 2,0 м²", price: 8990, area: 2, sort: 10 },
    { slug: "demo-mat-3-5", sku: "EH-DEMO-350", name: "Нагрівальний мат ElectroHeat 3,5 м²", price: null, area: 3.5, sort: 20 },
  ];
  for (const d of demo) {
    const p = await prisma.product.upsert({
      where: { slug: d.slug },
      create: {
        slug: d.slug,
        sku: d.sku,
        nameUk: d.name,
        nameNormKey: normalizeNameKey(d.name),
        shortDescription: "Демо-картка зі старого seed. Архівна — на сайті не показується.",
        priceUah: d.price,
        priceVisible: d.price != null,
        categoryId: mats.id,
        brandId: brand.id,
        published: true,
        archived: true,
        sortOrder: d.sort,
      },
      update: { archived: true, categoryId: mats.id },
    });
    for (const r of [
      { defId: area.id, num: d.area },
      { defId: power.id, num: 150 },
      { defId: voltage.id, num: 230 },
    ]) {
      await prisma.productSpec.upsert({
        where: { productId_definitionId: { productId: p.id, definitionId: r.defId } },
        create: { productId: p.id, definitionId: r.defId, valueNumber: r.num, valueText: null },
        update: { valueNumber: r.num },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
