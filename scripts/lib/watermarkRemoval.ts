/**
 * Стирання накладеного підпису (назви сайта) з фото товарів.
 *
 * Модель знака будується сама, без ручних шаблонів, із групи фото одного джерела:
 *   1. Середнє поле градієнтів по групі — накладений знак у всіх кадрах однаковий, вміст різний
 *      (ідея Dekel et al., CVPR 2017). Але самого середнього мало: спільна композиція фото
 *      (сотня кабелів у тій самій рамці) теж лишає слід.
 *   2. Когерентність |Σg| / Σ|g| відрізняє одне від одного: у накладеного знака градієнт у всіх
 *      фото той самий → 1, у вмісту напрямок випадковий → ~1/√N. Маска = когерентність і сила.
 *   3. Маска ділиться на зв'язні зони — по одній на кожне місце, де стоїть знак.
 *
 * Чи є знак на конкретному фото, вирішує проєкція його градієнтів на шаблон
 * r = Σ(g·t)/Σ|t|², а не косинус: косинус «розбавляється» власними градієнтами фото,
 * тож на насиченому кадрі знак виглядав би слабшим, ніж на порожньому.
 *
 * Прибирається знак заповненням: піраміда pull-push дає перше наближення, далі гармонічне
 * згладжування (рівняння Лапласа) по невідомих пікселях. На білому полі — де знак і стоїть
 * у більшості фото — слід зникає без залишку; там, де знак лежав на самому товарі,
 * лишається м'яка пляма: вміст під непрозорим знаком не відновити.
 */
import sharp from "sharp";

export type ModelGeometry =
  /** Фото точно такого розміру: знак накладено в пікселях, місце те саме. */
  | { kind: "exact"; w: number; h: number }
  /** Знак масштабується з шириною фото й притиснутий до низу (так робить Prom). */
  | { kind: "bottom-band"; refWidth: number; bandHeight: number };

export type GradientField = { gx: Float32Array; gy: Float32Array };

export type WatermarkModel = {
  key: string;
  donor: string;
  geometry: ModelGeometry;
  /** Розмір простору моделі. */
  w: number;
  h: number;
  /** Скільки фото усереднено. */
  count: number;
  /** Середнє поле градієнтів, занулене поза маскою. */
  tx: Float32Array;
  ty: Float32Array;
  /** Те саме поле поза маскою — контроль: там збігу бути не повинно. */
  cx: Float32Array;
  cy: Float32Array;
  controlEnergy: number;
  mask: Uint8Array;
  maskArea: number;
  zones: Uint32Array[];
  /** Σ|t|² по зоні — знаменник проєкції. */
  zoneEnergy: number[];
  zoneBox: { x0: number; y0: number; x1: number; y1: number }[];
  /** Частка фото групи, де знак упевнено знайдено. */
  markedShare: number;
};

export type ModelOptions = {
  /** Мінімум фото в групі: на меншій вибірці усереднення не гасить вміст. */
  minPhotos: number;
  /** Поріг когерентності градієнтів. */
  coherence: number;
  /** Поріг сили середнього поля, у частках від 99.9-го процентиля. */
  strength: number;
  /** Маска більша за цю частку кадру — це вже не підпис, а спільна композиція фото. */
  maxMaskShare: number;
  /** Маска менша за цю частку — шум усереднення, знака немає. */
  minMaskShare: number;
  /** Знак на фото є, якщо проєкція не менша. */
  detect: number;
  /** Шаблон приймаємо, лише якщо стільки фото групи мають знак. */
  minMarkedShare: number;
  /**
   * Накладений знак збігається з шаблоном майже піксель у піксель, тож косинус його градієнтів
   * із шаблоном високий. Спільна композиція фото (сотня схожих кабелів у тій самій рамці) теж
   * лишає слід у середньому полі, але косинус у неї втричі менший — саме цим і відрізняємо.
   */
  minCosine: number;
  /**
   * Наскільки збіг у зоні має перевищувати збіг поза нею. Якщо в групі є кілька майже однакових
   * фото, вони дають ідеальний збіг будь-де — але однаково і в зоні, і поза нею, а справжній
   * підпис стоїть на різному вмісті, тож поза зоною збігу немає.
   */
  minCosineMargin: number;
  /**
   * Скільки різних товарів мають мати знак у зоні. Значок на самому товарі (Wi-Fi, Google Play)
   * теж стоїть у тому самому місці й теж ідеально збігається — але лише в кількох товарів,
   * а підпис донора — у сотень.
   */
  minZoneProducts: number;
};

export const DEFAULT_MODEL_OPTIONS: ModelOptions = {
  minPhotos: 40,
  coherence: 0.55,
  strength: 0.12,
  maxMaskShare: 0.2,
  minMaskShare: 0.002,
  detect: 0.5,
  minMarkedShare: 0.5,
  minCosine: 0.6,
  minCosineMargin: 0.3,
  minZoneProducts: 20,
};

/** Фото в просторі моделі: сірим, потрібного розміру (для смуги — низ кадру). */
export async function modelSpaceGrey(
  buf: Buffer,
  geometry: ModelGeometry,
): Promise<{ data: Buffer; w: number; h: number } | null> {
  if (geometry.kind === "exact") {
    const { data } = await sharp(buf)
      .flatten({ background: "#ffffff" })
      .greyscale()
      .resize(geometry.w, geometry.h, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, w: geometry.w, h: geometry.h };
  }
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize({ width: geometry.refWidth })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.height < geometry.bandHeight) return null;
  const off = (info.height - geometry.bandHeight) * info.width;
  return { data: data.subarray(off, off + geometry.refWidth * geometry.bandHeight), w: geometry.refWidth, h: geometry.bandHeight };
}

export function sobel(px: Buffer, w: number, h: number): GradientField {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = px[i - w - 1], t = px[i - w], tr = px[i - w + 1];
      const l = px[i - 1], r = px[i + 1];
      const bl = px[i + w - 1], b = px[i + w], br = px[i + w + 1];
      gx[i] = tr + 2 * r + br - tl - 2 * l - bl;
      gy[i] = bl + 2 * b + br - tl - 2 * t - tr;
    }
  }
  return { gx, gy };
}

export async function modelSpaceGradient(buf: Buffer, geometry: ModelGeometry): Promise<GradientField | null> {
  const g = await modelSpaceGrey(buf, geometry);
  return g ? sobel(g.data, g.w, g.h) : null;
}

/** Зв'язні частини маски (сусідство 3 px, щоб літери одного напису не розпалися). */
function splitZones(mask: Uint8Array, w: number, h: number, minSize: number): Uint32Array[] {
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
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
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
  return zones.filter((z) => z.length >= minSize).map((z) => Uint32Array.from(z));
}

/** Маска йде по градієнтах, тобто по контуру; осердя товстих штрихів усередині контуру порожнє. */
function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !outside[i]) mask[i] = 1;
}

export type ModelBuildResult =
  | { ok: true; model: WatermarkModel }
  | { ok: false; reason: string; maskShare?: number; markedShare?: number; count: number };

/**
 * Накопичувач середнього поля градієнтів: фото сотні, тримати всі поля в пам'яті не можна,
 * тож група проходиться потоком.
 */
export class WatermarkAccumulator {
  private readonly sumGx: Float64Array;
  private readonly sumGy: Float64Array;
  private readonly sumMag: Float64Array;
  count = 0;
  constructor(readonly w: number, readonly h: number) {
    this.sumGx = new Float64Array(w * h);
    this.sumGy = new Float64Array(w * h);
    this.sumMag = new Float64Array(w * h);
  }
  add(f: GradientField): void {
    for (let i = 0; i < this.sumGx.length; i++) {
      this.sumGx[i] += f.gx[i];
      this.sumGy[i] += f.gy[i];
      this.sumMag[i] += Math.hypot(f.gx[i], f.gy[i]);
    }
    this.count++;
  }
  sums(): { gx: Float64Array; gy: Float64Array; mag: Float64Array } {
    return { gx: this.sumGx, gy: this.sumGy, mag: this.sumMag };
  }
}

/**
 * Модель знака по накопиченій групі однорідних фото. Повертає причину відмови, якщо група
 * не тягне на знак. `markedShare` тут ще не порахована — її дає окремий прохід
 * (`validateModel`), бо для неї потрібні градієнти кожного фото.
 */
export function buildWatermarkModel(
  acc: WatermarkAccumulator,
  donor: string,
  geometry: ModelGeometry,
  opts: ModelOptions = DEFAULT_MODEL_OPTIONS,
): ModelBuildResult {
  const { w, h } = acc;
  const count = acc.count;
  if (count < opts.minPhotos) return { ok: false, reason: `фото замало (< ${opts.minPhotos})`, count };

  const size = w * h;
  const { gx: sumGx, gy: sumGy, mag: sumMag } = acc.sums();
  const coherence = new Float32Array(size);
  const strength = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const mean = Math.hypot(sumGx[i], sumGy[i]);
    coherence[i] = sumMag[i] > 1e-6 ? mean / sumMag[i] : 0;
    strength[i] = mean / count;
  }
  const sorted = Float32Array.from(strength).sort();
  const cut = opts.strength * sorted[Math.floor(size * 0.999)];

  const mask = new Uint8Array(size);
  let area = 0;
  for (let i = 0; i < size; i++) {
    if (coherence[i] >= opts.coherence && strength[i] >= cut) {
      mask[i] = 1;
      area++;
    }
  }
  // Розмикання (ерозія 1 px + дилатація 1 px): поодинокі пікселі й волосинки від випадково
  // збіглих контурів вмісту зникають, штрихи знака завтовшки 2+ px лишаються. На великій групі
  // усереднення вже й так чисте, а розмикання там з'їдає бліді частини знака — тож лише для малих.
  if (count < 200) {
    const eroded = new Uint8Array(size);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) eroded[i] = 1;
      }
    }
    mask.fill(0);
    area = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!eroded[i]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w) mask[yy * w + xx] = 1;
          }
        }
      }
    }
    for (let i = 0; i < size; i++) if (mask[i]) area++;
  }
  if (area / size < opts.minMaskShare) return { ok: false, reason: "знака не видно", maskShare: area / size, count };
  if (area / size > opts.maxMaskShare) return { ok: false, reason: "маска завелика — схожі фото, а не підпис", maskShare: area / size, count };
  fillHoles(mask, w, h);
  area = mask.reduce((a: number, b) => a + b, 0);

  const tx = new Float32Array(size);
  const ty = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    if (!mask[i]) continue;
    tx[i] = sumGx[i] / count;
    ty[i] = sumGy[i] / count;
  }
  // Зона знака — це напис: компактний, не тонша за кілька пікселів і щільно заповнена.
  // Однакова в усіх фото рамка чи край кадру теж дають когерентний слід, але вони довгі й тонкі.
  const zones = splitZones(mask, w, h, Math.max(60, Math.round(size * 0.0005))).filter((z) => {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const i of z) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    return Math.min(bw, bh) >= 6 && bw * bh <= size * 0.3 && z.length / (bw * bh) >= 0.08;
  });
  if (!zones.length) return { ok: false, reason: "зони не схожі на напис", maskShare: area / size, count };

  // Усередині вже підтвердженої зони поріг послаблюємо: тонкі лінії логотипа (обрис даху,
  // підрядковий текст) суворий поріг не бере, а лишити їх — значить лишити кольоровий слід.
  // Поза зонами м'який поріг не діє, тож зайвого в маску не набереться.
  mask.fill(0);
  const grown: Uint32Array[] = [];
  for (const z of zones) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const i of z) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    // На малій групі послаблювати поріг не можна: там і сам шаблон ще шумний.
    const m = count >= 200 ? 4 : 0;
    const list: number[] = [];
    for (let y = Math.max(0, y0 - m); y <= Math.min(h - 1, y1 + m); y++) {
      for (let x = Math.max(0, x0 - m); x <= Math.min(w - 1, x1 + m); x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        if (count >= 200 && coherence[i] >= opts.coherence * 0.7 && strength[i] >= cut * 0.35) {
          mask[i] = 1;
          tx[i] = sumGx[i] / count;
          ty[i] = sumGy[i] / count;
          list.push(i);
        }
      }
    }
    for (const i of z) if (!mask[i]) { mask[i] = 1; list.push(i); }
    grown.push(Uint32Array.from(list));
  }
  zones.splice(0, zones.length, ...grown);
  area = zones.reduce((s2, z) => s2 + z.length, 0);

  const zoneEnergy = zones.map((z) => {
    let e = 0;
    for (const i of z) e += tx[i] * tx[i] + ty[i] * ty[i];
    return e;
  });
  const zoneBox = zones.map((z) => {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const i of z) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  });

  const cx = new Float32Array(size);
  const cy = new Float32Array(size);
  let controlEnergy = 0;
  for (let i = 0; i < size; i++) {
    if (mask[i]) continue;
    cx[i] = sumGx[i] / count;
    cy[i] = sumGy[i] / count;
    controlEnergy += cx[i] * cx[i] + cy[i] * cy[i];
  }

  const model: WatermarkModel = {
    key: `${donor}@${geometry.kind === "exact" ? `${w}x${h}` : `band${w}x${h}`}`,
    donor,
    geometry,
    w,
    h,
    count,
    tx,
    ty,
    cx,
    cy,
    controlEnergy,
    mask,
    maskArea: area,
    zones,
    zoneEnergy,
    zoneBox,
    markedShare: Number.NaN,
  };
  return { ok: true, model };
}

/** Зона на конкретному фото: наскільки збіглася і з яким зсувом. */
export type ZoneHit = { r: number; cos: number; dx: number; dy: number };

/**
 * Проєкція й косинус по кожній зоні плюс контрольний косинус поза маскою — за один прохід.
 *
 * Підпис стоїть не піксель у піксель: між фото він гуляє на кілька пікселів (у донора не одна
 * партія знімків), а усереднений шаблон сідає туди, де знак у більшості. Тому кожну зону
 * приміряємо з невеликим зсувом і беремо найкращий — без цього десята частина фото лишалася б
 * із підписом, бо шаблон від нього «промахується».
 */
export function zoneStats(
  model: WatermarkModel,
  field: GradientField,
  maxShift = 0,
  /** Якщо без зсуву збіг уже такий — не шукаємо: на більшості фото знак стоїть рівно на місці. */
  earlyAccept = Number.POSITIVE_INFINITY,
): { zones: ZoneHit[]; control: number } {
  const { w, h } = model;
  const zones: ZoneHit[] = [];
  for (const [z, zone] of model.zones.entries()) {
    const tt = model.zoneEnergy[z];
    const at = (dx: number, dy: number): ZoneHit => {
      let dot = 0;
      let ff = 0;
      for (const i of zone) {
        const x = (i % w) + dx;
        const y = ((i / w) | 0) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = y * w + x;
        dot += field.gx[j] * model.tx[i] + field.gy[j] * model.ty[i];
        ff += field.gx[j] * field.gx[j] + field.gy[j] * field.gy[j];
      }
      return { r: tt > 0 ? dot / tt : 0, cos: ff > 0 && tt > 0 ? dot / Math.sqrt(ff * tt) : 0, dx, dy };
    };
    let best = at(0, 0);
    if (maxShift > 0 && best.r < earlyAccept) {
      // Спершу грубо, через один піксель, потім уточнюємо навколо найкращого: повний перебір
      // ±5 px — це 121 приміряння на зону, а так їх утричі менше при тому самому результаті.
      for (let dy = -maxShift; dy <= maxShift; dy += 2) {
        for (let dx = -maxShift; dx <= maxShift; dx += 2) {
          if (!dx && !dy) continue;
          const hit = at(dx, dy);
          if (hit.r > best.r) best = hit;
        }
      }
      for (let dy = best.dy - 1; dy <= best.dy + 1; dy++) {
        for (let dx = best.dx - 1; dx <= best.dx + 1; dx++) {
          if (Math.abs(dx) > maxShift || Math.abs(dy) > maxShift) continue;
          const hit = at(dx, dy);
          if (hit.r > best.r) best = hit;
        }
      }
    }
    zones.push(best);
  }
  let cdot = 0;
  let cff = 0;
  for (let i = 0; i < model.mask.length; i++) {
    if (model.mask[i]) continue;
    cdot += field.gx[i] * model.cx[i] + field.gy[i] * model.cy[i];
    cff += field.gx[i] * field.gx[i] + field.gy[i] * field.gy[i];
  }
  const control = cff > 0 && model.controlEnergy > 0 ? cdot / Math.sqrt(cff * model.controlEnergy) : 0;
  return { zones, control };
}

/**
 * Перевірка шаблона на самих фото групи. Зону лишаємо, лише якщо там, де вона спрацювала,
 * градієнти справді збігаються з шаблоном (косинус) — інакше це не підпис, а схожість самих фото.
 * Зони, що не пройшли, викидаються: у групі може бути і справжній знак, і випадковий артефакт.
 */
export function validateModel(
  model: WatermarkModel,
  stats: { zones: ZoneHit[]; control: number }[],
  opts: ModelOptions = DEFAULT_MODEL_OPTIONS,
  /** Ключ товару для кожного фото — у тому самому порядку, що й stats. */
  productKeys?: string[],
): { ok: boolean; reason?: string; zoneCosine: number[]; control: number[]; zoneProducts: number[]; dropped: number } {
  const median = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 0);
  const zoneCosine = model.zones.map((_, z) => median(stats.filter((s) => s.zones[z].r >= opts.detect).map((s) => s.zones[z].cos)));
  const control = model.zones.map((_, z) => median(stats.filter((s) => s.zones[z].r >= opts.detect).map((s) => s.control)));
  const zoneProducts = model.zones.map((_, z) => {
    if (!productKeys) return Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    stats.forEach((s, k) => {
      if (s.zones[z].r >= opts.detect && productKeys[k]) seen.add(productKeys[k]);
    });
    return seen.size;
  });
  const keep = model.zones.map(
    (_, z) => zoneCosine[z] >= opts.minCosine && zoneCosine[z] - control[z] >= opts.minCosineMargin && zoneProducts[z] >= opts.minZoneProducts,
  );
  const dropped = keep.filter((k) => !k).length;
  if (!keep.some(Boolean)) {
    const best = Math.max(0, ...zoneCosine);
    return {
      ok: false,
      reason: `не підпис, а схожість самих фото (найкращий збіг ${best.toFixed(2)}, поза зоною ${Math.max(0, ...control).toFixed(2)})`,
      zoneCosine,
      control,
      zoneProducts,
      dropped,
    };
  }
  if (dropped) {
    model.zones = model.zones.filter((_, z) => keep[z]);
    model.zoneEnergy = model.zoneEnergy.filter((_, z) => keep[z]);
    model.zoneBox = model.zoneBox.filter((_, z) => keep[z]);
    model.mask = new Uint8Array(model.w * model.h);
    for (const zone of model.zones) for (const i of zone) model.mask[i] = 1;
    model.maskArea = model.zones.reduce((s, z) => s + z.length, 0);
  }
  const marked = stats.filter((s) => s.zones.some((hit, z) => keep[z] && hit.r >= opts.detect)).length;
  model.markedShare = stats.length ? marked / stats.length : 0;
  if (model.markedShare < opts.minMarkedShare) {
    return { ok: false, reason: `знак лише на ${(100 * model.markedShare).toFixed(0)}% фото групи`, zoneCosine, control, zoneProducts, dropped };
  }
  return {
    ok: true,
    zoneCosine: zoneCosine.filter((_, z) => keep[z]),
    control: control.filter((_, z) => keep[z]),
    zoneProducts: zoneProducts.filter((_, z) => keep[z]),
    dropped,
  };
}

/**
 * Маска зон моделі, перенесена в пікселі конкретного фото (модель живе у своєму масштабі).
 * `dilate` розширює маску: у знака є напівпрозорий ореол на кілька пікселів, і якщо лишити
 * його як межу заповнення, від підпису лишиться кольоровий контур.
 */
export function maskForImage(
  model: WatermarkModel,
  zones: PlacedZone[],
  imgW: number,
  imgH: number,
  dilate: number,
): Uint8Array {
  const out = new Uint8Array(imgW * imgH);
  const put = (mx: number, my: number) => {
    // Прямокутник пікселів фото, що відповідає пікселю моделі.
    let x0: number, x1: number, y0: number, y1: number;
    if (model.geometry.kind === "exact") {
      x0 = Math.floor((mx * imgW) / model.w);
      x1 = Math.max(x0, Math.ceil(((mx + 1) * imgW) / model.w) - 1);
      y0 = Math.floor((my * imgH) / model.h);
      y1 = Math.max(y0, Math.ceil(((my + 1) * imgH) / model.h) - 1);
    } else {
      const k = imgW / model.geometry.refWidth;
      const top = imgH - model.h * k;
      x0 = Math.floor(mx * k);
      x1 = Math.max(x0, Math.ceil((mx + 1) * k) - 1);
      y0 = Math.floor(top + my * k);
      y1 = Math.max(y0, Math.ceil(top + (my + 1) * k) - 1);
    }
    for (let y = Math.max(0, y0); y <= Math.min(imgH - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(imgW - 1, x1); x++) out[y * imgW + x] = 1;
    }
  };
  for (const z of zones) {
    for (const i of model.zones[z.zone]) put((i % model.w) + z.dx, ((i / model.w) | 0) + z.dy);
  }
  if (dilate <= 0) return out;
  const grown = new Uint8Array(out);
  for (let y = 0; y < imgH; y++) {
    for (let x = 0; x < imgW; x++) {
      if (!out[y * imgW + x]) continue;
      for (let dy = -dilate; dy <= dilate; dy++) {
        for (let dx = -dilate; dx <= dilate; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < imgH && xx >= 0 && xx < imgW) grown[yy * imgW + xx] = 1;
        }
      }
    }
  }
  return grown;
}

/**
 * Заповнення закритих пікселів: піраміда pull-push дає перше наближення (колір «підтягується»
 * з усе грубших рівнів), далі ітерації Лапласа роблять шов непомітним.
 */
export function inpaint(rgb: Float32Array, hole: Uint8Array, w: number, h: number, iterations = 200): Float32Array {
  const levels: { c: Float32Array; k: Float32Array; w: number; h: number }[] = [
    { c: Float32Array.from(rgb), k: Float32Array.from(hole, (v) => (v ? 0 : 1)), w, h },
  ];
  while (levels[levels.length - 1].w > 2 && levels[levels.length - 1].h > 2) {
    const p = levels[levels.length - 1];
    const nw = Math.ceil(p.w / 2);
    const nh = Math.ceil(p.h / 2);
    const nc = new Float32Array(nw * nh * 3);
    const nk = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sw = 0;
        const s = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const yy = y * 2 + dy;
            const xx = x * 2 + dx;
            if (yy >= p.h || xx >= p.w) continue;
            const i = yy * p.w + xx;
            sw += p.k[i];
            for (let c = 0; c < 3; c++) s[c] += p.c[i * 3 + c] * p.k[i];
          }
        }
        const i = y * nw + x;
        if (sw > 0) for (let c = 0; c < 3; c++) nc[i * 3 + c] = s[c] / sw;
        nk[i] = Math.min(1, sw / 2);
      }
    }
    levels.push({ c: nc, k: nk, w: nw, h: nh });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const cur = levels[l];
    const up = levels[l + 1];
    for (let y = 0; y < cur.h; y++) {
      for (let x = 0; x < cur.w; x++) {
        const i = y * cur.w + x;
        if (cur.k[i] >= 1) continue;
        const j = Math.min(up.h - 1, y >> 1) * up.w + Math.min(up.w - 1, x >> 1);
        const a = cur.k[i];
        for (let c = 0; c < 3; c++) cur.c[i * 3 + c] = cur.c[i * 3 + c] * a + up.c[j * 3 + c] * (1 - a);
        cur.k[i] = Math.max(cur.k[i], up.k[j]);
      }
    }
  }
  const out = levels[0].c;
  const holes: number[] = [];
  for (let i = 0; i < w * h; i++) if (hole[i]) holes.push(i);
  for (let it = 0; it < iterations; it++) {
    for (const i of holes) {
      const x = i % w;
      const y = (i / w) | 0;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        if (x > 0) { s += out[(i - 1) * 3 + c]; n++; }
        if (x < w - 1) { s += out[(i + 1) * 3 + c]; n++; }
        if (y > 0) { s += out[(i - w) * 3 + c]; n++; }
        if (y < h - 1) { s += out[(i + w) * 3 + c]; n++; }
        if (n) out[i * 3 + c] = s / n;
      }
    }
  }
  return out;
}

export type RemovalResult = {
  /** Фото без знака, у тому ж форматі. */
  buffer: Buffer;
  width: number;
  height: number;
  /** Скільки пікселів перемальовано. */
  changed: number;
};

/** Зона, знайдена на фото: індекс у моделі й зсув, з яким вона там стоїть. */
export type PlacedZone = { zone: number; dx: number; dy: number };

/** Прямокутник зони в пікселях фото. */
export function zoneRectForImage(
  model: WatermarkModel,
  placed: PlacedZone,
  imgW: number,
  imgH: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const z = model.zoneBox[placed.zone];
  const b = { x0: z.x0 + placed.dx, x1: z.x1 + placed.dx, y0: z.y0 + placed.dy, y1: z.y1 + placed.dy };
  if (model.geometry.kind === "exact") {
    return {
      x0: Math.max(0, Math.floor((b.x0 * imgW) / model.w)),
      x1: Math.min(imgW - 1, Math.ceil(((b.x1 + 1) * imgW) / model.w) - 1),
      y0: Math.max(0, Math.floor((b.y0 * imgH) / model.h)),
      y1: Math.min(imgH - 1, Math.ceil(((b.y1 + 1) * imgH) / model.h) - 1),
    };
  }
  const k = imgW / model.geometry.refWidth;
  const top = imgH - model.h * k;
  return {
    x0: Math.max(0, Math.floor(b.x0 * k)),
    x1: Math.min(imgW - 1, Math.ceil((b.x1 + 1) * k) - 1),
    y0: Math.max(0, Math.floor(top + b.y0 * k)),
    y1: Math.min(imgH - 1, Math.ceil(top + (b.y1 + 1) * k) - 1),
  };
}

/**
 * Прибирає знак у вказаних зонах і повертає фото в тому ж форматі та розмірі.
 *
 * Якщо навколо знака рівне тло (а так у більшості фото: підпис стоїть на білому полі),
 * закривається весь прямокутник зони — тоді не лишиться ні тонких ліній логотипа,
 * які маска могла не зачепити, ні ореолу. Там, де під знаком сам товар, закривається
 * лише маска: заливати прямокутник по живому вмісту дорожче, ніж лишити м'який слід.
 */
export async function removeWatermark(
  buf: Buffer,
  model: WatermarkModel,
  zones: PlacedZone[],
  opts: { dilate: number; jpegQuality: number; flatBackground: number },
): Promise<RemovalResult> {
  const meta = await sharp(buf).metadata();
  // Прозорість зберігаємо як є: заповнюємо лише кольорові канали, альфу повертаємо тою самою —
  // інакше фото з прозорим тлом отримало б біле тло.
  const alpha = meta.hasAlpha ? await sharp(buf).extractChannel(3).raw().toBuffer() : null;
  const { data, info } = await sharp(buf).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const hole = maskForImage(model, zones, w, h, opts.dilate);
  for (const z of zones) {
    // Запас навколо зони: у донора трапляється кілька варіантів логотипа, і тонкі лінії
    // іншого варіанта вилазять за межі зони. На рівному тлі це нічого не коштує.
    const r0 = zoneRectForImage(model, z, w, h);
    const pad = Math.max(2, Math.round(Math.min(w, h) * 0.015));
    const rect = {
      x0: Math.max(0, r0.x0 - pad),
      y0: Math.max(0, r0.y0 - pad),
      x1: Math.min(w - 1, r0.x1 + pad),
      y1: Math.min(h - 1, r0.y1 + pad),
    };
    let n = 0;
    const s = [0, 0, 0];
    const s2 = [0, 0, 0];
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const i = y * w + x;
        if (hole[i]) continue;
        n++;
        for (let c = 0; c < 3; c++) {
          const v = data[i * 3 + c];
          s[c] += v;
          s2[c] += v * v;
        }
      }
    }
    if (n < 30) continue;
    const std = Math.max(...s.map((sum, c) => Math.sqrt(Math.max(0, s2[c] / n - (sum / n) ** 2))));
    if (std > opts.flatBackground) continue;
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) hole[y * w + x] = 1;
  }
  let changed = 0;
  for (let i = 0; i < w * h; i++) if (hole[i]) changed++;
  const filled = inpaint(Float32Array.from(data), hole, w, h);
  const channels = alpha ? 4 : 3;
  const out = Buffer.alloc(w * h * channels);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) out[i * channels + c] = Math.round(Math.min(255, Math.max(0, filled[i * 3 + c])));
    if (alpha) out[i * channels + 3] = alpha[i];
  }
  let img = sharp(out, { raw: { width: w, height: h, channels } });
  img = meta.format === "png" ? img.png() : meta.format === "webp" ? img.webp({ quality: opts.jpegQuality }) : img.jpeg({ quality: opts.jpegQuality, chromaSubsampling: "4:4:4" });
  return { buffer: await img.toBuffer(), width: w, height: h, changed };
}
