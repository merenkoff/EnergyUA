/**
 * Імена файлів у MEDIA_ROOT для зовнішніх фото: {sha256(URL)}.{ext}.
 * Спільне для mirror-product-images.ts і ручного завантаження (manual-image-download.ts),
 * щоб файл, скачаний руками, mirror упізнав і не качав повторно.
 */
import { createHash } from "crypto";

export function hashUrl(u: string): string {
  return createHash("sha256").update(u, "utf8").digest("hex");
}

export function extFromContentType(ct: string | null): string {
  if (!ct) return "bin";
  const s = ct.split(";")[0].trim().toLowerCase();
  if (s.includes("jpeg")) return "jpg";
  if (s.includes("png")) return "png";
  if (s.includes("webp")) return "webp";
  if (s.includes("gif")) return "gif";
  return "bin";
}

export function extFromPathname(urlStr: string): string | null {
  try {
    const p = new URL(urlStr).pathname.toLowerCase();
    const m = p.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/);
    if (!m) return null;
    return m[1] === "jpeg" ? "jpg" : m[1];
  } catch {
    return null;
  }
}

/** Розширення, які mirror перебирає, шукаючи вже наявний файл для хешу. */
export const MEDIA_FILE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bin"] as const;
