import type { PrismaClient } from "@prisma/client";
import { nameSimilarityRatio, normalizeNameKey } from "./productDuplicateSimilarity";

const DEFAULT_WARN = 0.75;
const DEFAULT_MERGE = 0.9;
const MIN_NORM_LEN = 15;
const BUCKET_PREFIX_LEN = 12;

/** Пріоритет канону при злитті: ЕТ → IN-HEAT → Vsesezon → інше (за датою створення). */
const IMPORT_SOURCE_PRIORITY = ["et_market", "in_heat", "vsesezon"] as const;

function sourceRank(source: string | null | undefined): number {
  const i = (IMPORT_SOURCE_PRIORITY as readonly string[]).indexOf(source ?? "");
  return i === -1 ? 999 : i;
}

type RootRow = {
  id: string;
  nameUk: string;
  nameNormKey: string | null;
  externalSource: string | null;
  createdAt: Date;
};

function pickCanonicalId(ids: string[], byId: Map<string, RootRow>): string {
  return [...ids].sort((a, b) => {
    const ra = sourceRank(byId.get(a)?.externalSource);
    const rb = sourceRank(byId.get(b)?.externalSource);
    if (ra !== rb) return ra - rb;
    return byId.get(a)!.createdAt.getTime() - byId.get(b)!.createdAt.getTime();
  })[0];
}

function ultimateCanonicalId(id: string, pointsTo: Map<string, string>): string {
  let x = id;
  const seen = new Set<string>();
  while (pointsTo.has(x)) {
    const n = pointsTo.get(x)!;
    if (seen.has(n)) break;
    seen.add(x);
    x = n;
  }
  return x;
}

export type CrossSourceReconcileReport = {
  nameKeysBackfilled: number;
  mergeGroups: number;
  productsMerged: number;
  warnedPairs: number;
  warningSamples: { similarity: number; sources: [string, string]; names: [string, string] }[];
  mergedSamples: { canonicalSlug: string; mergedSlug: string; similarity: number }[];
};

/**
 * Після імпорту: між різними джерелами (et_market, in_heat, vsesezon, …) шукає пари зі схожістю назв.
 * ≥ mergeThreshold (0.9) — `mergedIntoProductId` на канонічну картку (пріоритет ЕТ-маркет).
 * [warnThreshold, mergeThreshold) — лише попередження в stderr.
 */
export async function reconcileCrossSourceDuplicates(
  prisma: PrismaClient,
  options?: { warnThreshold?: number; mergeThreshold?: number; quiet?: boolean },
): Promise<CrossSourceReconcileReport> {
  const warnThreshold = options?.warnThreshold ?? DEFAULT_WARN;
  const mergeThreshold = options?.mergeThreshold ?? DEFAULT_MERGE;
  const quiet = options?.quiet ?? false;

  const missingKey = await prisma.product.findMany({
    where: {
      OR: [{ nameNormKey: null }, { nameNormKey: "" }],
    },
    select: { id: true, nameUk: true },
  });

  let nameKeysBackfilled = 0;
  for (const row of missingKey) {
    const k = normalizeNameKey(row.nameUk);
    await prisma.product.update({
      where: { id: row.id },
      data: { nameNormKey: k || null },
    });
    nameKeysBackfilled++;
  }

  const roots = await prisma.product.findMany({
    where: {
      mergedIntoProductId: null,
      externalSource: { in: [...IMPORT_SOURCE_PRIORITY] },
    },
    select: {
      id: true,
      nameUk: true,
      nameNormKey: true,
      externalSource: true,
      createdAt: true,
    },
  });

  const byId = new Map<string, RootRow>();
  for (const r of roots) byId.set(r.id, r as RootRow);

  const buckets = new Map<string, RootRow[]>();
  for (const r of roots) {
    const k = (r.nameNormKey || normalizeNameKey(r.nameUk)).trim();
    if (k.length < MIN_NORM_LEN) continue;
    const pref = k.slice(0, BUCKET_PREFIX_LEN);
    const list = buckets.get(pref) ?? [];
    list.push(r as RootRow);
    buckets.set(pref, list);
  }

  const mergeCandidates: { idA: string; idB: string; sim: number }[] = [];
  let warnedPairs = 0;
  const warningSamples: CrossSourceReconcileReport["warningSamples"] = [];

  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.externalSource === b.externalSource) continue;
        const s1 = a.nameNormKey || normalizeNameKey(a.nameUk);
        const s2 = b.nameNormKey || normalizeNameKey(b.nameUk);
        if (s1.length < MIN_NORM_LEN || s2.length < MIN_NORM_LEN) continue;
        const sim = nameSimilarityRatio(s1, s2);
        if (sim >= mergeThreshold) {
          mergeCandidates.push({ idA: a.id, idB: b.id, sim });
        } else if (sim >= warnThreshold) {
          warnedPairs++;
          if (warningSamples.length < 25) {
            warningSamples.push({
              similarity: Math.round(sim * 1000) / 1000,
              sources: [a.externalSource ?? "?", b.externalSource ?? "?"] as [string, string],
              names: [a.nameUk.slice(0, 120), b.nameUk.slice(0, 120)] as [string, string],
            });
          }
        }
      }
    }
  }

  mergeCandidates.sort((x, y) => y.sim - x.sim);
  /** loserId → canonicalId (лише пари з різних джерел; не зливаємо два et_market через транзитивність). */
  const pointsTo = new Map<string, string>();

  for (const { idA, idB } of mergeCandidates) {
    const ua = ultimateCanonicalId(idA, pointsTo);
    const ub = ultimateCanonicalId(idB, pointsTo);
    if (ua === ub) continue;
    const rowA = byId.get(ua);
    const rowB = byId.get(ub);
    if (!rowA || !rowB) continue;
    if (rowA.externalSource === rowB.externalSource) continue;
    const canon = pickCanonicalId([ua, ub], byId);
    const loser = canon === ua ? ub : ua;
    pointsTo.set(loser, canon);
  }

  const mergeGroups = new Set(pointsTo.values()).size;
  const productsMerged = pointsTo.size;
  const mergedSamples: CrossSourceReconcileReport["mergedSamples"] = [];

  const allIds = [...new Set([...pointsTo.keys(), ...pointsTo.values()])];
  const slugs = await prisma.product.findMany({
    where: { id: { in: allIds } },
    select: { id: true, slug: true },
  });
  const slugById = new Map(slugs.map((s) => [s.id, s.slug]));

  for (const [loser, canon] of pointsTo) {
    const canonRow = byId.get(canon);
    const loserRow = byId.get(loser);
    const sCanon = canonRow
      ? canonRow.nameNormKey || normalizeNameKey(canonRow.nameUk)
      : "";
    const sLoser = loserRow ? loserRow.nameNormKey || normalizeNameKey(loserRow.nameUk) : "";
    const sim = sCanon && sLoser ? nameSimilarityRatio(sCanon, sLoser) : mergeThreshold;

    await prisma.product.update({
      where: { id: loser },
      data: { mergedIntoProductId: canon },
    });

    if (mergedSamples.length < 30) {
      mergedSamples.push({
        canonicalSlug: slugById.get(canon) ?? canon,
        mergedSlug: slugById.get(loser) ?? loser,
        similarity: Math.round(sim * 1000) / 1000,
      });
    }
  }

  if (!quiet) {
    console.error(
      JSON.stringify(
        {
          duplicateReconcile: {
            nameKeysBackfilled,
            warnedPairs,
            mergeGroups,
            productsMerged,
            warnThreshold,
            mergeThreshold,
          },
        },
        null,
        2,
      ),
    );
    if (warningSamples.length) {
      console.error("Можливі збіги (схожість ≥ " + warnThreshold + " і < " + mergeThreshold + "), приклади:");
      for (const w of warningSamples.slice(0, 10)) {
        console.error(`  sim=${w.similarity} ${w.sources[0]} vs ${w.sources[1]}`);
        console.error(`    A: ${w.names[0]}`);
        console.error(`    B: ${w.names[1]}`);
      }
    }
    if (mergedSamples.length) {
      console.error("Об’єднано (≥ " + mergeThreshold + "), приклади:");
      for (const m of mergedSamples.slice(0, 10)) {
        console.error(`  ${m.mergedSlug} → ${m.canonicalSlug} (sim≈${m.similarity})`);
      }
    }
  }

  return {
    nameKeysBackfilled,
    mergeGroups,
    productsMerged,
    warnedPairs,
    warningSamples,
    mergedSamples,
  };
}
