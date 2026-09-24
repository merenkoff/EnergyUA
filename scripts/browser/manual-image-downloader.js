// Ручне завантаження фото товарів у ВЛАСНОМУ браузері (інструкція: docs/MANUAL-IMAGE-DOWNLOAD.md).
//
// Це шаблон. Готовий сніпет зі списком фото генерує `npm run db:manual-images:prepare`
// (storage/manual-download/<host>/downloader.js). Його вставляють у консоль DevTools на сторінці
// донора після того, як сам пройшов перевірку Cloudflare («Just a moment…»).
//
// Сніпет качає фото тим самим браузером (ті самі cookies, та сама сесія), перевіряє, що це справді
// зображення, і віддає ZIP з іменами {sha256(URL)}.{ext}: саме так їх називає mirror-product-images.ts.
// Далі ZIP імпортує `npm run db:manual-images:ingest`.
(async () => {
  const CONFIG = /*__CONFIG__*/ null;
  if (!CONFIG) {
    console.error("[eh-download] Це шаблон без списку фото. Згенеруй сніпет: npm run db:manual-images:prepare");
    return;
  }

  const { host, items } = CONFIG; // items: [url, sha256(url), ext | null][]
  const CONCURRENCY = 2;
  const PAUSE_MS = 300;
  const MAX_BYTES = 15 * 1024 * 1024;
  // ZIP32 без стиснення; великі обсяги ріжемо на частини, щоб не тримати все в пам'яті вкладки.
  const ZIP_PART_BYTES = 400 * 1024 * 1024;
  const STOP_AFTER_FAILS_IN_ROW = 10;

  if (location.host !== host) {
    console.error(
      `[eh-download] Відкрий https://${host}/ , дочекайся, поки пройде перевірка «Just a moment…», і запусти сніпет на тій вкладці. Зараз відкрито: ${location.host}`,
    );
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const files = [];
  const failed = [];
  let pendingBytes = 0;
  let part = 0;
  let done = 0;
  let ok = 0;
  let failsInRow = 0;
  let stopped = false;
  let next = 0;

  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;padding:12px 16px;" +
    "background:#111;color:#fff;font:14px/1.45 system-ui,sans-serif;border-radius:8px;" +
    "box-shadow:0 4px 18px rgba(0,0,0,.45);white-space:pre-line";
  document.body.appendChild(box);
  const render = (msg) => {
    box.textContent = msg;
  };

  window.ehStopDownload = () => {
    stopped = true;
    console.warn("[eh-download] Зупиняю після поточних запитів…");
  };

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function sniffImage(b) {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
    if (
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    ) {
      return "webp";
    }
    return null;
  }

  // Те саме, що extFromContentType у scripts/lib/mediaFileNaming.ts.
  function extFromContentType(ct) {
    const s = (ct || "").split(";")[0].trim().toLowerCase();
    if (s.includes("jpeg")) return "jpg";
    if (s.includes("png")) return "png";
    if (s.includes("webp")) return "webp";
    if (s.includes("gif")) return "gif";
    return "bin";
  }

  function buildZip(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of entries) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0, true);
      lh.setUint16(8, 0, true); // STORE: фото вже стиснені
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);

      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }

  function flushZip() {
    if (!files.length) return;
    part += 1;
    const name = `${host}-images-${stamp}-${part}.zip`;
    const blob = buildZip(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
    console.log(`[eh-download] Збережено ${name}: ${files.length} фото, ${(blob.size / 1048576).toFixed(1)} МБ`);
    files.length = 0;
    pendingBytes = 0;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchOne(url, hash, ext) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) throw new Error("порожня відповідь");
    if (buf.length > MAX_BYTES) throw new Error(`більше ${MAX_BYTES} байт`);
    const ct = res.headers.get("content-type");
    if (!sniffImage(buf)) {
      throw new Error(`не зображення (${ct || "без content-type"}): схоже, знову перевірка Cloudflare`);
    }
    return { name: `${hash}.${ext || extFromContentType(ct)}`, data: buf };
  }

  async function worker() {
    while (!stopped && next < items.length) {
      const [url, hash, ext] = items[next++];
      try {
        const file = await fetchOne(url, hash, ext);
        files.push(file);
        pendingBytes += file.data.length;
        ok += 1;
        failsInRow = 0;
        if (pendingBytes >= ZIP_PART_BYTES) flushZip();
      } catch (e) {
        failed.push({ url, error: e instanceof Error ? e.message : String(e) });
        failsInRow += 1;
        if (failsInRow >= STOP_AFTER_FAILS_IN_ROW) {
          stopped = true;
          console.warn(`[eh-download] ${STOP_AFTER_FAILS_IN_ROW} помилок поспіль, зупиняюсь.`);
        }
      }
      done += 1;
      render(`ElectroHeat: фото з ${host}\n${done} / ${items.length}  ·  успішно ${ok}  ·  помилок ${failed.length}\nЗупинити: ehStopDownload() у консолі`);
      if (done % 25 === 0) console.log(`[eh-download] … ${done} / ${items.length} (помилок: ${failed.length})`);
      await sleep(PAUSE_MS);
    }
  }

  console.log(`[eh-download] Починаю: ${items.length} фото з ${host}. Не закривай і не оновлюй вкладку до кінця.`);
  render(`ElectroHeat: фото з ${host}\n0 / ${items.length}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flushZip();

  const left = items.length - ok;
  const summary =
    `Готово: ${ok} з ${items.length} фото у ZIP (файлів ZIP: ${part}).` +
    (failed.length ? ` Помилок: ${failed.length}.` : "") +
    (left
      ? `\nЛишилось ${left}: імпортуй ZIP (db:manual-images:ingest) — він згенерує новий сніпет лише для решти. ` +
        `Перед повтором онови сторінку (F5) і знову пройди перевірку.`
      : "\nДалі: npm run db:manual-images:ingest -- ~/Downloads/" + `${host}-images-*.zip`);
  render(`ElectroHeat: фото з ${host}\n${summary}`);
  console.log(`[eh-download] ${summary}`);
  if (failed.length) console.table(failed.slice(0, 50));
})();
