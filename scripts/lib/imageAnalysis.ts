/**
 * Аналіз фото товарів: розмір, різкість, perceptual hash (пошук того самого фото в різних донорів)
 * і оцінка водяного знака донора.
 *
 * Водяний знак шукаємо без ручних шаблонів: донор накладає той самий знак у тому самому місці
 * на всі свої фото, тому середнє (зі знаком) поле градієнтів по сотнях фото одного розміру
 * гасить різний вміст і лишає контур знака (ідея Dekel et al., CVPR 2017). Далі для кожного фото
 * рахуємо нормовану кореляцію його градієнтів із цим шаблоном у зоні знака.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isSafeMediaFilename } from "../../src/lib/mediaStorage";

export type ImageDonor = "et_market" | "in_heat" | "vsesezon" | "upload" | "other";

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

export async function loadImageBytes(url: string, opts: LoadOptions): Promise<Buffer> {
  if (url.startsWith("/api/media/")) {
    const name = url.slice("/api/media/".length).split("?")[0] ?? "";
    if (isSafeMediaFilename(name)) {
      try {
        return await readFile(path.join(opts.mediaRoot, name));
      } catch {
        /* немає на цьому диску — спробуємо сайт */
      }
    }
    if (!opts.mediaBaseUrl) throw new Error("файлу немає в MEDIA_ROOT, MEDIA_BASE_URL не задано");
    return fetchBytes(opts.mediaBaseUrl.replace(/\/$/, "") + url, opts);
  }
  if (url.startsWith("http://") || url.startsWith("https://")) return fetchBytes(url, opts);
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
      mx,
      my,
      strength,
      mask,
      maskArea: area,
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
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  noiseMedian: number;
  cut: number;
  p999: number;
};

/** Нормована кореляція градієнтів фото з шаблоном у зоні маски: ~0 — знака немає, ближче до 1 — є. */
export function watermarkScore(t: WatermarkTemplate, f: { gx: Float32Array; gy: Float32Array }): number {
  let dot = 0, ff = 0, tt = 0;
  for (let i = 0; i < t.mask.length; i++) {
    if (!t.mask[i]) continue;
    dot += f.gx[i] * t.mx[i] + f.gy[i] * t.my[i];
    ff += f.gx[i] * f.gx[i] + f.gy[i] * f.gy[i];
    tt += t.mx[i] * t.mx[i] + t.my[i] * t.my[i];
  }
  if (ff <= 0 || tt <= 0) return 0;
  return dot / Math.sqrt(ff * tt);
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
