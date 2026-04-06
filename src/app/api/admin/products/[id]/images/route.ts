import { NextResponse } from "next/server";
import { getAdminSessionCookie, verifyAdminSessionToken } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { saveProductImageBuffer, tryRemoveLocalMediaFile } from "@/lib/saveProductImage";

/** POST multipart: file (required), imageId (optional — заміна існуючого), sortOrder, altUk */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tok = await getAdminSessionCookie();
  if (!verifyAdminSessionToken(tok)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: productId } = await ctx.params;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const { publicUrl } = await saveProductImageBuffer(buf, mime);

  const imageId = typeof form.get("imageId") === "string" ? (form.get("imageId") as string).trim() : "";
  const sortOrderRaw = form.get("sortOrder");
  const sortOrder =
    typeof sortOrderRaw === "string" && sortOrderRaw ? parseInt(sortOrderRaw, 10) : undefined;
  const altUk = typeof form.get("altUk") === "string" ? (form.get("altUk") as string).trim() || null : null;

  if (imageId) {
    const prev = await prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!prev) return NextResponse.json({ error: "Image not found" }, { status: 404 });
    await tryRemoveLocalMediaFile(prev.url);
    const img = await prisma.productImage.update({
      where: { id: imageId },
      data: {
        url: publicUrl,
        sourceUrl: null,
        altUk: altUk ?? prev.altUk,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder! : prev.sortOrder,
      },
    });
    return NextResponse.json({ image: img });
  }

  const maxSo = await prisma.productImage.aggregate({
    where: { productId },
    _max: { sortOrder: true },
  });
  const nextOrder = Number.isFinite(sortOrder) ? sortOrder! : (maxSo._max.sortOrder ?? -1) + 1;

  const img = await prisma.productImage.create({
    data: {
      productId,
      url: publicUrl,
      altUk,
      sortOrder: nextOrder,
    },
  });
  return NextResponse.json({ image: img });
}
