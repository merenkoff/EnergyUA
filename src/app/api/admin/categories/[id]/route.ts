import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { allocateUniqueCategorySlug, categorySlugFromLabel } from "@/lib/categorySlug";
import { childrenMapFromRows, collectDescendantIds } from "@/lib/categoryTree";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allRows = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const childMap = childrenMapFromRows(allRows);
  const descendants = collectDescendantIds(id, childMap);

  const data: {
    nameUk?: string;
    nameRu?: string | null;
    description?: string | null;
    slug?: string;
    sortOrder?: number;
    parentId?: string | null;
  } = {};

  if (typeof body.nameUk === "string" && body.nameUk.trim()) {
    data.nameUk = body.nameUk.trim();
  }

  if (body.nameRu === null) data.nameRu = null;
  else if (typeof body.nameRu === "string") data.nameRu = body.nameRu.trim() || null;

  if (body.description === null) data.description = null;
  else if (typeof body.description === "string") data.description = body.description.trim() || null;

  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    data.sortOrder = Math.trunc(body.sortOrder);
  }

  if (typeof body.slug === "string" && body.slug.trim()) {
    const want = categorySlugFromLabel(body.slug.trim());
    if (want !== existing.slug) {
      const taken = await prisma.category.findFirst({
        where: { slug: want, NOT: { id } },
        select: { id: true },
      });
      data.slug = taken ? await allocateUniqueCategorySlug(prisma, want) : want;
    }
  }

  if ("parentId" in body) {
    if (body.parentId === null) {
      data.parentId = null;
    } else if (typeof body.parentId === "string") {
      const pid = body.parentId.trim();
      if (pid === id) {
        return NextResponse.json({ error: "Категорія не може бути батьком сама собі" }, { status: 400 });
      }
      if (descendants.has(pid)) {
        return NextResponse.json({ error: "Неможливо перемістити категорію всередину власної підгілки" }, { status: 400 });
      }
      const p = await prisma.category.findUnique({ where: { id: pid }, select: { id: true } });
      if (!p) {
        return NextResponse.json({ error: "Батьківська категорія не знайдена" }, { status: 400 });
      }
      data.parentId = pid;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ category: existing });
  }

  try {
    const updated = await prisma.category.update({
      where: { id },
      data,
    });
    return NextResponse.json({ category: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
