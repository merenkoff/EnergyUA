import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { TAG_GROUPS } from "@/lib/tagGroups";
import { allocateUniqueTagSlug, tagSlugFromLabel } from "@/lib/tagSlug";

/** Створити мітку (manual = true — seed її не чіпає). */
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
  if (!nameUk) return NextResponse.json({ error: "Назва обов'язкова" }, { status: 400 });
  const groupSlug = typeof body.groupSlug === "string" && body.groupSlug.trim() ? body.groupSlug.trim() : null;
  if (groupSlug && !TAG_GROUPS.some((g) => g.slug === groupSlug)) {
    return NextResponse.json({ error: "Невідома група міток" }, { status: 400 });
  }
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const sortOrder = typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder) ? Math.trunc(body.sortOrder) : 0;
  const slugBase = tagSlugFromLabel(typeof body.slug === "string" && body.slug.trim() ? body.slug : nameUk);

  try {
    const slug = await allocateUniqueTagSlug(prisma, slugBase);
    const tag = await prisma.tag.create({ data: { slug, nameUk, groupSlug, description, sortOrder, manual: true } });
    return NextResponse.json({ tag });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 400 });
  }
}
