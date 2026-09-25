import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";

/** Повна заміна міток товару. Після цього імпорт прайсів мітки цього товару не чіпає (tagsManual). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: { tagIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.tagIds) || !body.tagIds.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "tagIds: масив id міток" }, { status: 400 });
  }
  const tagIds = [...new Set(body.tagIds as string[])];

  const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const known = await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } });
  if (known.length !== tagIds.length) {
    return NextResponse.json({ error: "Невідома мітка" }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.productTag.deleteMany({ where: { productId: id, tagId: { notIn: tagIds } } }),
    prisma.productTag.createMany({ data: tagIds.map((tagId) => ({ productId: id, tagId })), skipDuplicates: true }),
    prisma.product.update({ where: { id }, data: { tagsManual: true } }),
  ]);
  const tags = await prisma.productTag.findMany({ where: { productId: id }, select: { tagId: true } });
  return NextResponse.json({ tagIds: tags.map((t) => t.tagId), tagsManual: true });
}
