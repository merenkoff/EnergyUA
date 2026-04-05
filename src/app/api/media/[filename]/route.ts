import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getMediaRoot, isSafeMediaFilename, joinMediaFile } from "@/lib/mediaStorage";

function contentTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bin: "application/octet-stream",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const { filename } = await ctx.params;
  const decoded = filename ? decodeURIComponent(filename) : "";
  if (!decoded || !isSafeMediaFilename(decoded)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const root = getMediaRoot();
  const full = joinMediaFile(root, decoded);
  if (!full) return new NextResponse("Not found", { status: 404 });

  try {
    const buf = await readFile(full);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentTypeForFilename(decoded),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
