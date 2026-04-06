import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { tryRemoveLocalMediaFile } from "@/lib/saveProductImage";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; imageId: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId, imageId } = await ctx.params;
  const row = await prisma.productImage.findFirst({ where: { id: imageId, productId } });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { altUk?: string | null; sortOrder?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: { altUk?: string | null; sortOrder?: number } = {};
  if (body.altUk !== undefined) data.altUk = body.altUk;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) data.sortOrder = body.sortOrder;

  const img = await prisma.productImage.update({ where: { id: imageId }, data });
  return NextResponse.json({ image: img });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; imageId: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId, imageId } = await ctx.params;
  const row = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await tryRemoveLocalMediaFile(row.url);
  await prisma.productImage.delete({ where: { id: imageId } });
  return NextResponse.json({ ok: true });
}
