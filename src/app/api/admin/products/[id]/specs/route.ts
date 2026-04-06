import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";

/** PATCH: { specs: [{ id, valueText?, valueNumber? }] } — лише існуючі product_specs. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await ctx.params;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { specs?: { id: string; valueText?: string | null; valueNumber?: number | null }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rows = body.specs;
  if (!Array.isArray(rows)) return NextResponse.json({ error: "specs array required" }, { status: 400 });

  for (const row of rows) {
    if (!row.id) continue;
    const ps = await prisma.productSpec.findFirst({
      where: { id: row.id, productId },
    });
    if (!ps) continue;

    const data: Prisma.ProductSpecUpdateInput = {};
    if (row.valueText !== undefined) data.valueText = row.valueText;
    if (row.valueNumber === null) data.valueNumber = null;
    else if (typeof row.valueNumber === "number" && Number.isFinite(row.valueNumber)) {
      data.valueNumber = new Prisma.Decimal(row.valueNumber);
    }
    await prisma.productSpec.update({ where: { id: row.id }, data });
  }

  const specs = await prisma.productSpec.findMany({
    where: { productId },
    include: { definition: true },
    orderBy: { definition: { sortOrder: "asc" } },
  });
  return NextResponse.json({ specs });
}
