import path from "path";

/** Папка з файлами зображень. На Railway — Volume, наприклад /data/media. Локально — storage/media. */
export function getMediaRoot(): string {
  return process.env.MEDIA_ROOT?.trim() || path.join(process.cwd(), "storage", "media");
}

export const PUBLIC_MEDIA_PATH_PREFIX = "/api/media";

/** Ім'я файлу: 64 hex sha256 + розширення (лише латиниця, нижній регістр). */
export function isSafeMediaFilename(name: string): boolean {
  return /^[a-f0-9]{64}\.(jpe?g|png|webp|gif|bin)$/i.test(name);
}

export function joinMediaFile(mediaRoot: string, filename: string): string | null {
  if (!isSafeMediaFilename(filename)) return null;
  const resolved = path.resolve(mediaRoot, filename);
  const rootResolved = path.resolve(mediaRoot);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) return null;
  return resolved;
}
