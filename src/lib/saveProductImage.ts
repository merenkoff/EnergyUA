import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMediaRoot, isSafeMediaFilename, joinMediaFile } from "@/lib/mediaStorage";

const MAX_BYTES = 15 * 1024 * 1024;

function extFromMime(mime: string): string {
  const s = mime.split(";")[0].trim().toLowerCase();
  if (s.includes("jpeg")) return "jpg";
  if (s.includes("png")) return "png";
  if (s.includes("webp")) return "webp";
  if (s.includes("gif")) return "gif";
  return "bin";
}

/** Зберігає буфер у MEDIA_ROOT як {sha256}.{ext}, повертає публічний шлях /api/media/... */
export async function saveProductImageBuffer(buf: Buffer, mime: string): Promise<{ filename: string; publicUrl: string }> {
  if (buf.length > MAX_BYTES) throw new Error(`Файл більше ${MAX_BYTES} байт`);
  const hash = createHash("sha256").update(buf).digest("hex");
  const ext = extFromMime(mime);
  const filename = `${hash}.${ext}`;
  const root = getMediaRoot();
  const full = joinMediaFile(root, filename);
  if (!full) throw new Error("Некоректне ім'я файлу");
  await mkdir(root, { recursive: true });
  await writeFile(full, buf);
  return { filename, publicUrl: `/api/media/${filename}` };
}

/** Видаляє локальний файл, якщо url виглядає як /api/media/{sha256.ext}. */
export async function tryRemoveLocalMediaFile(url: string): Promise<void> {
  const prefix = "/api/media/";
  if (!url.startsWith(prefix)) return;
  const name = url.slice(prefix.length).split("?")[0]?.trim() ?? "";
  if (!isSafeMediaFilename(name)) return;
  const full = joinMediaFile(getMediaRoot(), name);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    /* ignore */
  }
}
