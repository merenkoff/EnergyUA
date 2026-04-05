import { PrismaClient } from "@prisma/client";
import { normalizeNameKey } from "../scripts/lib/productDuplicateSimilarity";

const prisma = new PrismaClient();

async function main() {
  const root = await prisma.category.upsert({
    where: { slug: "tepla-pidloga" },
    create: {
      slug: "tepla-pidloga",
      nameUk: "Тепла підлога",
      nameRu: "Тёплый пол",
      description: "Електричні системи обігріву підлоги: мати, кабель, плівка.",
      sortOrder: 0,
    },
    update: { nameUk: "Тепла підлога" },
  });

  const mats = await prisma.category.upsert({
    where: { slug: "nagrivalni-maty" },
    create: {
      slug: "nagrivalni-maty",
      nameUk: "Нагрівальні мати",
      nameRu: "Нагревательные маты",
      parentId: root.id,
      sortOrder: 10,
    },
    update: { parentId: root.id },
  });

  await prisma.category.upsert({
    where: { slug: "griuchi-kabeli" },
    create: {
      slug: "griuchi-kabeli",
      nameUk: "Гріючі кабелі",
      nameRu: "Греющие кабели",
      parentId: root.id,
      sortOrder: 20,
    },
    update: { parentId: root.id },
  });

  const brand = await prisma.brand.upsert({
    where: { slug: "demo-heat" },
    create: { slug: "demo-heat", name: "ElectroHeat Demo" },
    update: {},
  });

  const area = await prisma.specDefinition.upsert({
    where: { slug: "area_m2" },
    create: {
      slug: "area_m2",
      labelUk: "Площа обігріву",
      unit: "м²",
      groupSlug: "dimensions",
      filterable: true,
      sortOrder: 10,
    },
    update: { filterable: true },
  });

  const power = await prisma.specDefinition.upsert({
    where: { slug: "power_w_m2" },
    create: {
      slug: "power_w_m2",
      labelUk: "Потужність",
      unit: "Вт/м²",
      groupSlug: "electrical",
      filterable: true,
      sortOrder: 20,
    },
    update: {},
  });

  const voltage = await prisma.specDefinition.upsert({
    where: { slug: "voltage_v" },
    create: {
      slug: "voltage_v",
      labelUk: "Напруга",
      unit: "В",
      groupSlug: "electrical",
      filterable: true,
      sortOrder: 30,
    },
    update: {},
  });

  const p1 = await prisma.product.upsert({
    where: { slug: "demo-mat-2-0" },
    create: {
      slug: "demo-mat-2-0",
      sku: "EH-DEMO-200",
      nameUk: "Нагрівальний мат ElectroHeat 2,0 м²",
      nameNormKey: normalizeNameKey("Нагрівальний мат ElectroHeat 2,0 м²"),
      shortDescription: "Двожильний мат для укладання під плитку в клей.",
      description:
        "<p>Приклад картки товару під структуру як на маркетплейсах: короткий опис, характеристики, артикул.</p>",
      priceUah: 8990,
      priceVisible: true,
      categoryId: mats.id,
      brandId: brand.id,
      published: true,
      sortOrder: 10,
      seoTitle: "Нагрівальний мат 2 м² — каталог ElectroHeat",
    },
    update: {
      published: true,
      categoryId: mats.id,
      nameNormKey: normalizeNameKey("Нагрівальний мат ElectroHeat 2,0 м²"),
    },
  });

  const p2 = await prisma.product.upsert({
    where: { slug: "demo-mat-3-5" },
    create: {
      slug: "demo-mat-3-5",
      sku: "EH-DEMO-350",
      nameUk: "Нагрівальний мат ElectroHeat 3,5 м²",
      nameNormKey: normalizeNameKey("Нагрівальний мат ElectroHeat 3,5 м²"),
      shortDescription: "Збільшена площа — для ванної чи коридору.",
      priceVisible: false,
      categoryId: mats.id,
      brandId: brand.id,
      published: true,
      sortOrder: 20,
    },
    update: {
      published: true,
      nameNormKey: normalizeNameKey("Нагрівальний мат ElectroHeat 3,5 м²"),
    },
  });

  async function setSpecs(
    productId: string,
    rows: { defId: string; num?: number; text?: string }[],
  ) {
    for (const r of rows) {
      await prisma.productSpec.upsert({
        where: {
          productId_definitionId: { productId, definitionId: r.defId },
        },
        create: {
          productId,
          definitionId: r.defId,
          valueNumber: r.num != null ? r.num : null,
          valueText: r.text ?? null,
        },
        update: {
          valueNumber: r.num != null ? r.num : null,
          valueText: r.text ?? null,
        },
      });
    }
  }

  await setSpecs(p1.id, [
    { defId: area.id, num: 2 },
    { defId: power.id, num: 150 },
    { defId: voltage.id, num: 230 },
  ]);

  await setSpecs(p2.id, [
    { defId: area.id, num: 3.5 },
    { defId: power.id, num: 150 },
    { defId: voltage.id, num: 230 },
  ]);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
