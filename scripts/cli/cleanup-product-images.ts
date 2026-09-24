/**
 * Прибирає водяні знаки донорів з вітрини — не редагуючи самі файли:
 *   1) фото без знака стає обкладинкою товару (перевпорядкування sort_order);
 *   2) фото зі знаком замінюється на той самий знімок із чистого джерела, якщо він знайшовся.
 *
 *   npm run img:analyze -- --out out/images.json     # спершу аналіз ПО БД (не --manifests)
 *   npm run img:cleanup -- --from out/images.json    # показати план, нічого не змінюючи
 *   npm run img:cleanup -- --from out/images.json --apply
 *
 * Файли на диску лишаються як є, у product_images.source_url зберігається походження,
 * тож будь-яку зміну можна відкотити повторним імпортом.
 */
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const FROM = ((): string | null => {
  const i = process.argv.indexOf("--from");
  return i === -1 ? null : process.argv[i + 1] ?? null;
})();

type AnalysisImage = {
  key: string;
  url: string;
  sourceUrl: string | null;
  donor: string;
  width: number | null;
  height: number | null;
  hasWatermark: boolean;
  watermark: number | null;
  imageIds: string[];
  productIds: string[];
};

type Analysis = {
  source: string;
  images: AnalysisImage[];
  replacements: { from: string; to: string; distance: number }[];
};

function log(...a: unknown[]) {
  console.log("[cleanup]", ...a);
}

async function main() {
  if (!FROM) throw new Error("вкажи --from <файл аналізу> (npm run img:analyze -- --out …)");
  const analysis: Analysis = JSON.parse(await readFile(FROM, "utf8"));
  if (analysis.source !== "db") {
    throw new Error(`аналіз зроблено з ${analysis.source}: id фото несправжні. Потрібен прогін по БД (без --manifests)`);
  }

  const byKey = new Map(analysis.images.map((i) => [i.key, i]));
  const rows = await prisma.productImage.findMany({
    select: { id: true, productId: true, url: true, sourceUrl: true, sortOrder: true },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
  });
  const infoFor = (r: { url: string; sourceUrl: string | null }) => byKey.get(r.sourceUrl?.trim() || r.url);

  // 1. Заміна знімка на той самий, але без знака.
  const replacementFor = new Map<string, AnalysisImage>();
  for (const rep of analysis.replacements) {
    const to = byKey.get(rep.to);
    if (to && !to.hasWatermark) replacementFor.set(rep.from, to);
  }

  type Change = { id: string; url?: string; sourceUrl?: string | null; sortOrder?: number };
  const changes: Change[] = [];
  let replaced = 0;

  const rowInfo = new Map<string, AnalysisImage | undefined>();
  for (const r of rows) rowInfo.set(r.id, infoFor(r));

  for (const r of rows) {
    const info = rowInfo.get(r.id);
    if (!info?.hasWatermark) continue;
    const better = replacementFor.get(info.key);
    if (!better) continue;
    changes.push({ id: r.id, url: better.url, sourceUrl: better.sourceUrl ?? better.key });
    rowInfo.set(r.id, better);
    replaced++;
  }

  // 2. Чисте фото — обкладинкою. Відносний порядок усередині груп зберігаємо.
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
    byProduct.get(r.productId)!.push(r);
  }
  let reordered = 0;
  for (const [, list] of byProduct) {
    const withInfo = list.filter((r) => rowInfo.get(r.id));
    if (withInfo.length < 2) continue;
    const dirty = withInfo.filter((r) => rowInfo.get(r.id)!.hasWatermark);
    if (!dirty.length || dirty.length === withInfo.length) continue;

    const sorted = [...list].sort((a, b) => {
      const wa = rowInfo.get(a.id)?.hasWatermark ? 1 : 0;
      const wb = rowInfo.get(b.id)?.hasWatermark ? 1 : 0;
      return wa !== wb ? wa - wb : a.sortOrder - b.sortOrder;
    });
    let changedHere = false;
    sorted.forEach((r, idx) => {
      if (r.sortOrder === idx) return;
      const existing = changes.find((c) => c.id === r.id);
      if (existing) existing.sortOrder = idx;
      else changes.push({ id: r.id, sortOrder: idx });
      changedHere = true;
    });
    if (changedHere) reordered++;
  }

  const coverDirtyBefore = [...byProduct.values()].filter((l) => infoFor(l[0])?.hasWatermark).length;
  log(`фото в БД: ${rows.length}; товарів: ${byProduct.size}`);
  log(`заміна знімка на чистий: ${replaced} фото`);
  log(`товарів, де чисте фото стає обкладинкою: ${reordered}`);
  log(`обкладинок зі знаком було: ${coverDirtyBefore}`);
  log(`усього змін рядків: ${changes.length}`);

  for (const c of changes.slice(0, 8)) {
    log(`  ${c.id}${c.url ? ` url→${c.url.slice(0, 60)}` : ""}${c.sortOrder != null ? ` sort→${c.sortOrder}` : ""}`);
  }

  if (!APPLY) {
    log("це попередній перегляд — нічого не змінено. Додай --apply, щоб записати.");
    return;
  }

  // Порядок фото унікальний лише в межах товару, тому пишемо просто по рядках.
  let done = 0;
  for (const c of changes) {
    await prisma.productImage.update({
      where: { id: c.id },
      data: {
        ...(c.url != null ? { url: c.url } : {}),
        ...(c.sourceUrl !== undefined ? { sourceUrl: c.sourceUrl } : {}),
        ...(c.sortOrder != null ? { sortOrder: c.sortOrder } : {}),
      },
    });
    if (++done % 200 === 0) log(`  записано ${done} / ${changes.length}`);
  }
  log(`записано змін: ${done}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
