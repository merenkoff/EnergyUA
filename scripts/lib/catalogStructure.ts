/**
 * Структура каталогу, яку гарантують seed та імпорт прайсів (ідемпотентно):
 *  - корінь «Каталог» (katalog) і його розділи з таксономії;
 *  - корінь «Архів» (arkhiv); старий корінь tepla-pidloga переноситься під нього разом з усім піддеревом;
 *  - мітки (tags) і бренди з таксономії.
 */
import type { PrismaClient } from "@prisma/client";
import { ARCHIVE_ROOT_SLUG, BRANDS, CATALOG_ROOT_SLUG, CATALOG_SECTIONS, LEGACY_ROOT_SLUG, TAGS } from "./pricelistTaxonomy";

export async function ensureCatalogStructure(prisma: PrismaClient) {
  const root = await prisma.category.upsert({
    where: { slug: CATALOG_ROOT_SLUG },
    create: {
      slug: CATALOG_ROOT_SLUG,
      nameUk: "Каталог",
      nameRu: "Каталог",
      description: "Електрична тепла підлога, терморегулятори, антиобледеніння та суміжне обладнання з прайсів постачальників.",
      sortOrder: 0,
    },
    update: { parentId: null },
  });

  const archive = await prisma.category.upsert({
    where: { slug: ARCHIVE_ROOT_SLUG },
    create: {
      slug: ARCHIVE_ROOT_SLUG,
      nameUk: "Архів",
      nameRu: "Архив",
      description: "Старий каталог, зібраний з сайтів-донорів. Товари приховані, поки в адмінці не знято прапорець «архівний».",
      sortOrder: 1000,
    },
    update: { parentId: null, sortOrder: 1000 },
  });

  // Старий корінь seed (tepla-pidloga) з усіма розділами донорів — під «Архів».
  const legacy = await prisma.category.findUnique({ where: { slug: LEGACY_ROOT_SLUG }, select: { id: true, parentId: true } });
  if (legacy && legacy.parentId !== archive.id) {
    await prisma.category.update({ where: { id: legacy.id }, data: { parentId: archive.id } });
  }
  // Інші кореневі категорії, що лишилися від імпортів (крім katalog/arkhiv), — теж в архів.
  await prisma.category.updateMany({
    where: { parentId: null, slug: { notIn: [CATALOG_ROOT_SLUG, ARCHIVE_ROOT_SLUG] } },
    data: { parentId: archive.id },
  });

  const sections = new Map<string, string>();
  for (const c of CATALOG_SECTIONS) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, nameUk: c.nameUk, nameRu: c.nameRu ?? null, description: c.description ?? null, parentId: root.id, sortOrder: c.sortOrder },
      update: { nameUk: c.nameUk, nameRu: c.nameRu ?? null, description: c.description ?? null, parentId: root.id, sortOrder: c.sortOrder },
      select: { id: true },
    });
    sections.set(c.slug, row.id);
  }

  const tags = new Map<string, string>();
  for (const t of TAGS) {
    const row = await prisma.tag.upsert({
      where: { slug: t.slug },
      create: { slug: t.slug, nameUk: t.nameUk, groupSlug: t.groupSlug, description: t.description ?? null, sortOrder: t.sortOrder },
      update: { nameUk: t.nameUk, groupSlug: t.groupSlug, description: t.description ?? null, sortOrder: t.sortOrder },
      select: { id: true },
    });
    tags.set(t.slug, row.id);
  }

  const brands = new Map<string, string>();
  for (const b of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { slug: b.slug },
      create: { slug: b.slug, name: b.name },
      update: { name: b.name },
      select: { id: true },
    });
    brands.set(b.slug, row.id);
  }

  return { rootId: root.id, archiveId: archive.id, sections, tags, brands };
}
