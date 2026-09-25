import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { TAG_GROUPS } from "@/lib/tagGroups";
import { allocateUniqueTagSlug, tagSlugFromLabel } from "@/lib/tagSlug";

async function authorized(): Promise<boolean> {
  const tok = await getAdminSessionCookie();
  return verifyAdminSessionToken(tok);
}

/** Редагування мітки. Після цього вона manual = true: seed не повертає назву/групу з таксономії. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await authorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: { nameUk?: string; slug?: string; groupSlug?: string | null; description?: string | null; sortOrder?: number; manual: boolean } = {
    manual: true,
  };
  if (typeof body.nameUk === "string" && body.nameUk.trim()) data.nameUk = body.nameUk.trim();
  if (body.groupSlug === null || body.groupSlug === "") data.groupSlug = null;
  else if (typeof body.groupSlug === "string") {
    if (!TAG_GROUPS.some((g) => g.slug === body.groupSlug)) {
      return NextResponse.json({ error: "Невідома група міток" }, { status: 400 });
    }
    data.groupSlug = body.groupSlug;
  }
  if (body.description === null) data.description = null;
  else if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) data.sortOrder = Math.trunc(body.sortOrder);
  if (typeof body.slug === "string" && body.slug.trim()) {
    const want = tagSlugFromLabel(body.slug);
    if (want !== existing.slug) data.slug = await allocateUniqueTagSlug(prisma, want, id);
  }

  try {
    const tag = await prisma.tag.update({ where: { id }, data });
    return NextResponse.json({ tag });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

/** Видалити мітку. Зв'язки з товарами видаляються каскадом; ?force=1 потрібен, якщо мітка ще на товарах. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await authorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const existing = await prisma.tag.findUnique({ where: { id }, select: { id: true, _count: { select: { products: true } } } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (existing._count.products > 0 && !force) {
    return NextResponse.json(
      { error: `Мітка стоїть на ${existing._count.products} товарах. Підтвердьте видалення.`, products: existing._count.products },
      { status: 409 },
    );
  }
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true, removedFromProducts: existing._count.products });
}
