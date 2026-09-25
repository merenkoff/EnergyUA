import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { readPricelistProductFile } from "@/lib/pricelistProductFile";
import { prisma } from "@/lib/prisma";

/** Повернути мітки «як у прайсі»: знімає tagsManual і перечитує data/catalog/<id>.json. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, externalSource: true, externalId: true },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = await readPricelistProductFile(product.externalSource, product.externalId);
  if (!file) {
    return NextResponse.json({ error: "Це не товар із прайсу або файл товару не знайдено" }, { status: 400 });
  }
  const tags = await prisma.tag.findMany({ where: { slug: { in: file.tags } }, select: { id: true } });
  const tagIds = tags.map((t) => t.id);
  await prisma.$transaction([
    prisma.productTag.deleteMany({ where: { productId: id, tagId: { notIn: tagIds } } }),
    prisma.productTag.createMany({ data: tagIds.map((tagId) => ({ productId: id, tagId })), skipDuplicates: true }),
    prisma.product.update({ where: { id }, data: { tagsManual: false } }),
  ]);
  return NextResponse.json({ tagIds, tagsManual: false });
}
