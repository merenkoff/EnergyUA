import { readFile } from "node:fs/promises";
import path from "node:path";
import { PRICELIST_SOURCE } from "@/lib/catalogRoot";

/**
 * JSON-файл товару з прайсу (data/catalog/<постачальник>/<sku-slug>.json), якщо товар імпортовано з прайсів.
 * Потрібен адмінці, щоб повернути мітки «як у прайсі». Файли лежать у репозиторії, отже і в контейнері.
 */
export async function readPricelistProductFile(
  externalSource: string | null,
  externalId: string | null,
): Promise<{ tags: string[] } | null> {
  if (externalSource !== PRICELIST_SOURCE || !externalId) return null;
  const [supplier, key] = externalId.split("/");
  if (!supplier || !key || !/^[a-z0-9-]+$/.test(supplier) || !/^[a-z0-9-]+$/.test(key)) return null;
  const file = path.join(process.cwd(), "data", "catalog", supplier, `${key}.json`);
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { tags?: unknown };
    return { tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [] };
  } catch {
    return null;
  }
}
