/**
 * Аналіз фото товарів: розмір, різкість, perceptual hash (пошук того самого фото в різних донорів)
 * і оцінка водяного знака донора.
 *
 * Водяний знак шукаємо без ручних шаблонів: донор накладає той самий знак у тому самому місці
 * на всі свої фото, тому середнє (зі знаком) поле градієнтів по сотнях фото одного розміру
 * гасить різний вміст і лишає контур знака (ідея Dekel et al., CVPR 2017). Далі для кожного фото
 * рахуємо нормовану кореляцію його градієнтів із цим шаблоном у зоні знака.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isSafeMediaFilename } from "../../src/lib/mediaStorage";
import { nameSimilarityRatio, normalizeNameKey } from "./productDuplicateSimilarity";

/** Ті самі межі, що в crossSourceDuplicateMerge: коротка назва не є доказом дубліката. */
const MIN_NORM_LEN = 15;
const BUCKET_PREFIX_LEN = 12;

export type ImageDonor = "et_market" | "in_heat" | "vsesezon" | "upload" | "other";

/** Рядок «фото товару» — з БД або з манифестів data/scrape. */
export type ImageRow = {
  /** id рядка product_images; для манифестів — синтетичний. */
  imageId: string;
  url: string;
  sourceUrl: string | null;
  sortOrder: number;
  productId: string;
  productName: string;
  productSource: string | null;
  productExternalId: string | null;
  mergedIntoProductId: string | null;
};

/** Звідки фото: за оригінальним URL (після mirror він у sourceUrl), інакше за url. */
export function imageDonor(url: string, sourceUrl: string | null | undefined): ImageDonor {
  const u = sourceUrl?.trim() || url;
  let host: string;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return u.startsWith("/api/media/") ? "upload" : "other";
  }
  if (host.endsWith("et-market.com.ua")) return "et_market";
  if (host.endsWith("in-heat.kiev.ua")) return "in_heat";
  if (host.endsWith("prom.ua")) return "vsesezon";
  return "other";
}

export type LoadOptions = {
  mediaRoot: string;
  /** Якщо файлу немає локально (скрипт не в контейнері з volume) — брати /api/media/… з цього сайту. */
  mediaBaseUrl?: string;
  userAgent: string;
  maxBytes: number;
};

async function fetchBytes(url: string, opts: LoadOptions): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": opts.userAgent, Accept: "image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > opts.maxBytes) throw new Error(`body > ${opts.maxBytes} bytes`);
  return buf;
}

/** Імена файлів у MEDIA_ROOT — читаємо каталог один раз (mirror кладе сюди тисячі файлів). */
let mediaIndex: { root: string; names: Set<string> } | null = null;

async function mediaNames(root: string): Promise<Set<string>> {
  if (mediaIndex?.root === root) return mediaIndex.names;
  const names = new Set<string>();
  try {
    for (const n of await readdir(root)) if (!n.startsWith(".")) names.add(n);
  } catch {
    /* каталогу ще немає */
  }
  mediaIndex = { root, names };
  return names;
}

/** mirror називає файл sha256(оригінальний URL) — тож зовнішній URL теж може вже лежати на диску. */
async function localFileForUrl(externalUrl: string, root: string): Promise<string | null> {
  const hash = createHash("sha256").update(externalUrl, "utf8").digest("hex");
  const names = await mediaNames(root);
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "bin"]) {
    const name = `${hash}.${ext}`;
    if (names.has(name)) return path.join(root, name);
  }
  return null;
}

/**
 * Байти фото: спершу локальний файл (volume або storage/media), потім мережа.
 * `sourceUrl` — оригінальний URL донора, за яким mirror іменував файл.
 */
export async function loadImageBytes(url: string, sourceUrl: string | null | undefined, opts: LoadOptions): Promise<Buffer> {
  if (url.startsWith("/api/media/")) {
    const name = url.slice("/api/media/".length).split("?")[0] ?? "";
    if (isSafeMediaFilename(name)) {
      try {
        return await readFile(path.join(opts.mediaRoot, name));
      } catch {
        /* немає на цьому диску — пробуємо далі */
      }
    }
    if (opts.mediaBaseUrl) return fetchBytes(opts.mediaBaseUrl.replace(/\/$/, "") + url, opts);
    const src = sourceUrl?.trim();
    if (src) return loadImageBytes(src, null, opts);
    throw new Error("файлу немає в MEDIA_ROOT, MEDIA_BASE_URL не задано");
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const local = await localFileForUrl(url, opts.mediaRoot);
    if (local) return readFile(local);
    return fetchBytes(url, opts);
  }
  throw new Error("невідомий формат url");
}

// ---------- perceptual hash ----------

const PHASH_N = 32;
const PHASH_K = 8;
const DCT_COS: Float64Array = (() => {
  const t = new Float64Array(PHASH_K * PHASH_N);
  for (let u = 0; u < PHASH_K; u++) {
    for (let x = 0; x < PHASH_N; x++) t[u * PHASH_N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_N));
  }
  return t;
})();

/**
 * Рамка «вмісту» на білому фоні: межі, між якими лежить 1–99 % небілих пікселів по кожній осі.
 * На відміну від trim, дрібний напис/логотип донора в порожньому полі не розширює рамку.
 */
function contentBox(px: Buffer, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ink = 255 - px[y * w + x];
      if (ink > 24) {
        cols[x] += ink;
        rows[y] += ink;
        total += ink;
      }
    }
  }
  if (total <= 0) return null;
  const span = (a: Float64Array): [number, number] => {
    let acc = 0, lo = 0, hi = a.length - 1;
    for (let i = 0; i < a.length; i++) {
      acc += a[i];
      if (acc >= total * 0.01) { lo = i; break; }
    }
    acc = 0;
    for (let i = a.length - 1; i >= 0; i--) {
      acc += a[i];
      if (acc >= total * 0.01) { hi = i; break; }
    }
    return [lo, hi];
  };
  const [x0, x1] = span(cols);
  const [y0, y1] = span(rows);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * pHash (64 біти, hex) по фото без білих полів: донори по-різному доповнюють фото до квадрата
 * (500×500 з полями, 220×200 пропорційно), тому спершу вирізаємо рамку вмісту.
 */
async function perceptualHash(buf: Buffer): Promise<string | null> {
  const g = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const box = contentBox(g.data, g.info.width, g.info.height);
  let src = sharp(g.data, { raw: { width: g.info.width, height: g.info.height, channels: 1 } });
  if (box && box.x1 - box.x0 >= 8 && box.y1 - box.y0 >= 8) {
    src = src.extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 });
  }
  const { data } = await src.resize(PHASH_N, PHASH_N, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });

  // Роздільне 2D DCT, лише перші 8×8 коефіцієнтів.
  const rows = new Float64Array(PHASH_N * PHASH_K);
  for (let y = 0; y < PHASH_N; y++) {
    for (let u = 0; u < PHASH_K; u++) {
      let s = 0;
      for (let x = 0; x < PHASH_N; x++) s += data[y * PHASH_N + x] * DCT_COS[u * PHASH_N + x];
      rows[y * PHASH_K + u] = s;
    }
  }
  const coef = new Float64Array(PHASH_K * PHASH_K);
  for (let v = 0; v < PHASH_K; v++) {
    for (let u = 0; u < PHASH_K; u++) {
      let s = 0;
      for (let y = 0; y < PHASH_N; y++) s += rows[y * PHASH_K + u] * DCT_COS[v * PHASH_N + y];
      coef[v * PHASH_K + u] = s;
    }
  }
  const ac = Array.from(coef.slice(1)).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (i + b > 0 && coef[i + b] > median ? 1 : 0);
    hex += nib.toString(16);
  }
  // Повністю однорідне фото (заглушка «немає фото» тощо) дає нульовий хеш — такі не порівнюємо.
  return /^0+$/.test(hex) ? null : hex;
}

const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT4[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

// ---------- базові ознаки ----------

export type ImageFeatures = {
  width: number;
  height: number;
  format: string;
  phash: string | null;
  /** Дисперсія лапласіана на зображенні до 512 px: < ~50 — розмите/стиснуте. */
  sharpness: number;
};

export async function computeFeatures(buf: Buffer): Promise<ImageFeatures> {
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: meta.width ?? info.width,
    height: meta.height ?? info.height,
    format: meta.format ?? "unknown",
    phash: await perceptualHash(buf),
    sharpness: laplacianVariance(data, info.width, info.height),
  };
}

function laplacianVariance(px: Buffer, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = px[i - w] + px[i + w] + px[i - 1] + px[i + 1] - 4 * px[i];
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ---------- водяний знак ----------

/** Поле градієнтів (Собель) на фото, приведеному до w×h. */
export async function gradientField(buf: Buffer, w: number, h: number): Promise<{ gx: Float32Array; gy: Float32Array }> {
  const { data } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = data[i - w - 1], t = data[i - w], tr = data[i - w + 1];
      const l = data[i - 1], r = data[i + 1];
      const bl = data[i + w - 1], b = data[i + w], br = data[i + w + 1];
      gx[i] = tr + 2 * r + br - tl - 2 * l - bl;
      gy[i] = bl + 2 * b + br - tl - 2 * t - tr;
    }
  }
  return { gx, gy };
}

/** Менша частка площі під маскою — це шум усереднення, а не знак (у донорів зі знаком: 4–7 %). */
const MIN_MASK_SHARE = 0.005;

/** Накопичує середнє поле градієнтів групи фото одного розміру. */
export class WatermarkEstimator {
  readonly sumGx: Float64Array;
  readonly sumGy: Float64Array;
  count = 0;
  constructor(readonly w: number, readonly h: number) {
    this.sumGx = new Float64Array(w * h);
    this.sumGy = new Float64Array(w * h);
  }
  add(f: { gx: Float32Array; gy: Float32Array }): void {
    for (let i = 0; i < f.gx.length; i++) {
      this.sumGx[i] += f.gx[i];
      this.sumGy[i] += f.gy[i];
    }
    this.count++;
  }
  build(maskSigma = 6): WatermarkTemplate {
    const n = Math.max(1, this.count);
    const size = this.w * this.h;
    const mx = new Float32Array(size);
    const my = new Float32Array(size);
    const strength = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      mx[i] = this.sumGx[i] / n;
      my[i] = this.sumGy[i] / n;
      strength[i] = Math.hypot(mx[i], my[i]);
    }
    const sorted = Array.from(strength).sort((a, b) => a - b);
    const median = sorted[Math.floor(size / 2)];
    const mad = Array.from(strength, (s) => Math.abs(s - median)).sort((a, b) => a - b)[Math.floor(size / 2)];
    const p999 = sorted[Math.floor(size * 0.999)];
    // Поріг: і статистично значуще над шумом, і не менше 35 % від піку — інакше в маску потрапляють
    // «залишки» контурів товарів у центрі кадру, які не повністю погасилися усередненням.
    const cut = Math.max(median + maskSigma * 1.4826 * Math.max(mad, 1e-6), 0.35 * p999);
    // Маска = сильні пікселі шаблону, розширені на 2 px (контури знака тонкі).
    const core = new Uint8Array(size);
    for (let i = 0; i < size; i++) core[i] = strength[i] > cut ? 1 : 0;
    const mask = new Uint8Array(size);
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1, area = 0;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let on = 0;
        for (let dy = -2; dy <= 2 && !on; dy++) {
          for (let dx = -2; dx <= 2 && !on; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy >= 0 && yy < this.h && xx >= 0 && xx < this.w && core[yy * this.w + xx]) on = 1;
          }
        }
        if (on) {
          mask[y * this.w + x] = 1;
          area++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return {
      w: this.w,
      h: this.h,
      count: this.count,
      zones: splitMaskIntoZones(mask, this.w, this.h),
      mx,
      my,
      strength,
      mask,
      maskArea: area,
      // Порожній шаблон (донор без знака) дає лише дрібний шум — так ми й відрізняємо «знака немає».
      valid: area / size >= MIN_MASK_SHARE,
      minMaskShare: MIN_MASK_SHARE,
      bbox: area ? { x0, y0, x1, y1 } : null,
      noiseMedian: median,
      cut,
      p999,
    };
  }
}

export type WatermarkTemplate = {
  w: number;
  h: number;
  count: number;
  mx: Float32Array;
  my: Float32Array;
  strength: Float32Array;
  mask: Uint8Array;
  maskArea: number;
  /** Зв'язні частини маски: донор ставить той самий знак у кількох місцях, і не завжди в усіх. */
  zones: Uint32Array[];
  /** Чи схожий шаблон на справжній знак, а не на шум (маска ≥ minMaskShare площі). */
  valid: boolean;
  minMaskShare: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  noiseMedian: number;
  cut: number;
  p999: number;
};

/** Нормована кореляція градієнтів фото з шаблоном у зоні маски: ~0 — знака немає, ближче до 1 — є. */
/** Зв'язні області маски (8-зв'язність); дрібні шумові плями відкидаємо. */
function splitMaskIntoZones(mask: Uint8Array, w: number, h: number): Uint32Array[] {
  const seen = new Uint8Array(mask.length);
  const zones: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const zone: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      zone.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    zones.push(zone);
  }
  zones.sort((a, b) => b.length - a.length);
  const biggest = zones[0]?.length ?? 0;
  return zones.filter((z) => z.length >= Math.max(30, biggest * 0.05)).map((z) => Uint32Array.from(z));
}

function zoneScore(t: WatermarkTemplate, f: { gx: Float32Array; gy: Float32Array }, zone: Uint32Array): number {
  let dot = 0, ff = 0, tt = 0;
  for (const i of zone) {
    dot += f.gx[i] * t.mx[i] + f.gy[i] * t.my[i];
    ff += f.gx[i] * f.gx[i] + f.gy[i] * f.gy[i];
    tt += t.mx[i] * t.mx[i] + t.my[i] * t.my[i];
  }
  if (ff <= 0 || tt <= 0) return 0;
  return dot / Math.sqrt(ff * tt);
}

/**
 * Наскільки фото збігається зі шаблоном знака. Донор ставить знак у кількох місцях,
 * але на конкретному фото може бути лише частина з них, тому беремо найкращу зону,
 * а не середнє по всій масці — інакше присутній знак «розбавляється» порожніми зонами.
 */
export function watermarkScore(t: WatermarkTemplate, f: { gx: Float32Array; gy: Float32Array }): number {
  if (!t.zones.length) return 0;
  let best = -1;
  for (const z of t.zones) {
    const s = zoneScore(t, f, z);
    if (s > best) best = s;
  }
  return best;
}

/** ASCII-карта сили шаблону — щоб побачити форму й місце знака прямо в логах. */
export function asciiMap(values: Float32Array, w: number, h: number, cols = 100, rows = 50): string[] {
  const ramp = " .:-=+*#%@";
  const sorted = Array.from(values).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.5)];
  const hi = sorted[Math.floor(sorted.length * 0.999)] || 1;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    const ya = Math.floor((r * h) / rows), yb = Math.max(ya + 1, Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const xa = Math.floor((c * w) / cols), xb = Math.max(xa + 1, Math.floor(((c + 1) * w) / cols));
      let m = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) m = Math.max(m, values[y * w + x]);
      const v = Math.min(1, Math.max(0, (m - lo) / Math.max(hi - lo, 1e-6)));
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
    }
    out.push(line);
  }
  return out;
}

/** Шаблон знака для набору фото, приведених до w×h. null — фото замало для усереднення. */
export async function buildTemplate(buffers: Buffer[], w: number, h: number, minCount = 40): Promise<WatermarkTemplate | null> {
  if (buffers.length < minCount) return null;
  const est = new WatermarkEstimator(w, h);
  for (const b of buffers) est.add(await gradientField(b, w, h));
  return est.build();
}

// ---------- джерело: манифести data/scrape ----------

type ManifestProduct = {
  source: string;
  externalId: string;
  nameUk: string;
  images?: ({ url: string; alt?: string } | string)[];
};

/**
 * Рядки «фото товару» прямо з манифестів — щоб аналізувати каталог без БД
 * (ті самі файли, що й після імпорту: ключ товару — source + externalId).
 */
export async function manifestImageRows(scrapeDir: string): Promise<ImageRow[]> {
  const files = ["et-catalog-DETAIL.json", "in-heat-catalog-DETAIL.json", "vsesezon-catalog.json"];
  const rows: ImageRow[] = [];
  for (const f of files) {
    let parsed: { products?: ManifestProduct[] };
    try {
      parsed = JSON.parse(await readFile(path.join(scrapeDir, f), "utf8"));
    } catch {
      continue;
    }
    for (const p of parsed.products ?? []) {
      const productId = `${p.source}-${p.externalId}`;
      let sortOrder = 0;
      for (const im of p.images ?? []) {
        const url = typeof im === "string" ? im : im.url;
        if (!url) continue;
        rows.push({
          imageId: `${productId}#${sortOrder}`,
          url,
          sourceUrl: null,
          sortOrder: sortOrder++,
          productId,
          productName: p.nameUk,
          productSource: p.source,
          productExternalId: p.externalId,
          mergedIntoProductId: null,
        });
      }
    }
  }
  return rows;
}

// ---------- групи товарів-дублікатів ----------

/**
 * Ті самі групи, що їх робить імпорт (`crossSourceDuplicateMerge`): назви різних донорів
 * зі схожістю ≥ 0.9 — це один товар. Потрібно, щоб узяти фото того самого товару в донора,
 * який не ставить водяних знаків.
 */
export function groupDuplicateProducts(
  products: { productId: string; name: string; source: string | null }[],
  mergeThreshold = 0.9,
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const norm = new Map<string, string>();
  for (const p of products) {
    parent.set(p.productId, p.productId);
    norm.set(p.productId, normalizeNameKey(p.name));
  }

  // Бакети за префіксом — щоб не порівнювати кожен з кожним.
  const buckets = new Map<string, string[]>();
  for (const p of products) {
    const k = norm.get(p.productId)!;
    if (k.length < MIN_NORM_LEN) continue;
    const b = k.slice(0, BUCKET_PREFIX_LEN);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(p.productId);
  }
  const sourceOf = new Map(products.map((p) => [p.productId, p.source ?? ""]));
  for (const ids of buckets.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (sourceOf.get(ids[i]) === sourceOf.get(ids[j])) continue;
        if (nameSimilarityRatio(norm.get(ids[i])!, norm.get(ids[j])!) >= mergeThreshold) union(ids[i], ids[j]);
      }
    }
  }
  return new Map(products.map((p) => [p.productId, find(p.productId)]));
}
