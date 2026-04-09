import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { allocateUniqueCategorySlug, categorySlugFromLabel } from "@/lib/categorySlug";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nameUk = typeof body.nameUk === "string" ? body.nameUk.trim() : "";
  if (!nameUk) {
    return NextResponse.json({ error: "nameUk обов'язковий" }, { status: 400 });
  }

  const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
  if (!parentId) {
    return NextResponse.json({ error: "parentId обов'язковий (оберіть батьківську категорію)" }, { status: 400 });
  }

  const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true } });
  if (!parent) {
    return NextResponse.json({ error: "Батьківська категорія не знайдена" }, { status: 400 });
  }

  let slugBase: string;
  if (typeof body.slug === "string" && body.slug.trim()) {
    slugBase = categorySlugFromLabel(body.slug.trim());
  } else {
    slugBase = categorySlugFromLabel(nameUk);
  }

  let nameRu: string | null | undefined;
  if (body.nameRu === null) nameRu = null;
  else if (typeof body.nameRu === "string") nameRu = body.nameRu.trim() || null;
  else nameRu = undefined;

  let description: string | null | undefined;
  if (body.description === null) description = null;
  else if (typeof body.description === "string") description = body.description.trim() || null;
  else description = undefined;

  let sortOrder = 0;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) sortOrder = Math.trunc(body.sortOrder);

  try {
    const slug = await allocateUniqueCategorySlug(prisma, slugBase);
    const created = await prisma.category.create({
      data: {
        slug,
        nameUk,
        parentId,
        sortOrder,
        ...(nameRu !== undefined ? { nameRu } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
    return NextResponse.json({ category: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
