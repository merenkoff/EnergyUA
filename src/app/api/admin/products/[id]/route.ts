import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { normalizeNameKey } from "@/lib/normalizeNameKey";
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

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Prisma.ProductUpdateInput = {};

  if (typeof body.slug === "string") data.slug = body.slug.trim();
  if (body.sku === null) data.sku = null;
  else if (typeof body.sku === "string") data.sku = body.sku.trim() || null;

  if (typeof body.nameUk === "string") {
    data.nameUk = body.nameUk;
    data.nameNormKey = normalizeNameKey(body.nameUk);
  }
  if (typeof body.nameNormKey === "string" && body.nameNormKey.trim()) {
    data.nameNormKey = body.nameNormKey.trim();
  }
  if (body.nameRu === null) data.nameRu = null;
  else if (typeof body.nameRu === "string") data.nameRu = body.nameRu;

  if (body.shortDescription === null) data.shortDescription = null;
  else if (typeof body.shortDescription === "string") data.shortDescription = body.shortDescription;

  if (body.description === null) data.description = null;
  else if (typeof body.description === "string") data.description = body.description;

  if (body.priceUah === null) data.priceUah = null;
  else if (typeof body.priceUah === "number" && Number.isFinite(body.priceUah)) {
    data.priceUah = new Prisma.Decimal(body.priceUah);
  } else if (typeof body.priceUah === "string" && body.priceUah.trim()) {
    data.priceUah = new Prisma.Decimal(body.priceUah.replace(",", "."));
  }

  if (typeof body.priceVisible === "boolean") data.priceVisible = body.priceVisible;
  if (typeof body.published === "boolean") data.published = body.published;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) data.sortOrder = body.sortOrder;

  if (body.seoTitle === null) data.seoTitle = null;
  else if (typeof body.seoTitle === "string") data.seoTitle = body.seoTitle;
  if (body.seoDescription === null) data.seoDescription = null;
  else if (typeof body.seoDescription === "string") data.seoDescription = body.seoDescription;

  if (typeof body.categoryId === "string") data.category = { connect: { id: body.categoryId } };
  if (body.brandId === null) data.brand = { disconnect: true };
  else if (typeof body.brandId === "string") data.brand = { connect: { id: body.brandId } };

  if (body.externalSource === null) data.externalSource = null;
  else if (typeof body.externalSource === "string") data.externalSource = body.externalSource.trim() || null;

  if (body.externalId === null) data.externalId = null;
  else if (typeof body.externalId === "string") data.externalId = body.externalId.trim() || null;

  if (body.externalUrl === null) data.externalUrl = null;
  else if (typeof body.externalUrl === "string") data.externalUrl = body.externalUrl.trim() || null;

  if (body.sourceCategoryUrl === null) data.sourceCategoryUrl = null;
  else if (typeof body.sourceCategoryUrl === "string") data.sourceCategoryUrl = body.sourceCategoryUrl.trim() || null;

  if (body.mergedIntoProductId === null) data.mergedInto = { disconnect: true };
  else if (typeof body.mergedIntoProductId === "string") {
    data.mergedInto = { connect: { id: body.mergedIntoProductId } };
  }

  try {
    const updated = await prisma.product.update({
      where: { id },
      data,
    });
    return NextResponse.json({ product: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
