#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Завантажує фото товарів з офіційних сайтів брендів для позицій, у прайсах яких фото немає.

Джерела описані вручну в data/catalog-media/external-sources.json:
  [{ "supplier": "ar-ryxon-flex", "brand": "ryxon", "match": {"skuPrefix": ["HM-200-"]},
     "urls": ["https://…/photo.jpg"], "page": "https://…", "note": "…" }, …]
  match — {"skuPrefix": [...]} (артикул починається з рядка, без урахування регістру) або {"sku": [...]} (точно).
  urls — рядки або {"url": "…", "cropBottom": 0.1}: cropBottom — частка висоти, яку відрізати знизу
  (підпис дистриб'ютора під фото); можна задати і на весь запис.

Скрипт зберігає кожен URL як data/catalog-media/<sha256>.<jpg|png> (як extract_pricelist_images.py: до 1200 px,
webp → jpg/png) і пише data/catalog-media/external.json: { "<url>": {"file", "width", "height"} }.
Парсер прайсів (parse_pricelists.py) підставляє ці файли товарам, у яких не знайшлося фото в самому прайсі.

Запуск: python3 scripts/pricelists/fetch_external_images.py [--refresh]   (--refresh — перекачати все)
Залежності: pip install pillow; мережа — через curl.
"""
from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_pricelist_images import MAX_SIDE, OUT  # noqa: E402

SOURCES = OUT / "external-sources.json"
STATE = OUT / "external.json"
MAX_PNG_BYTES = 400_000  # більший PNG з прозорістю → JPEG на білому тлі
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ElectroHeat-catalog"


def download(url: str) -> bytes:
    r = subprocess.run(
        ["curl", "-sSL", "--fail", "--max-time", "90", "-A", UA, "-o", "-", url],
        capture_output=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip() or f"curl exit {r.returncode}")
    return r.stdout


def normalize(data: bytes, crop_bottom: float = 0.0) -> tuple[bytes, str, int, int]:
    """Будь-який формат → jpg (або png, якщо є прозорість), не більше MAX_SIDE по більшій стороні."""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    fmt = (im.format or "").lower()
    if crop_bottom:
        im = im.crop((0, 0, im.width, int(round(im.height * (1 - crop_bottom)))))
    elif max(im.size) <= MAX_SIDE and fmt in ("jpeg", "png") and not (fmt == "png" and not has_alpha and len(data) > 200_000):
        return data, ("jpg" if fmt == "jpeg" else "png"), im.width, im.height
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    if has_alpha:
        im.convert("RGBA").save(buf, format="PNG", optimize=True)
        if len(buf.getvalue()) <= MAX_PNG_BYTES:
            return buf.getvalue(), "png", im.width, im.height
        # важкий PNG з прозорістю: кладемо на біле тло (каталог і так на білому) і зберігаємо як JPEG
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im.convert("RGBA"))
        buf = io.BytesIO()
    im.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue(), "jpg", im.width, im.height


def main() -> None:
    refresh = "--refresh" in sys.argv
    sources = json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else []
    state: dict[str, dict] = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() and not refresh else {}
    wanted: dict[str, float] = {}
    for s in sources:
        for u in s.get("urls", []):
            if isinstance(u, dict):
                wanted.setdefault(u["url"], float(u.get("cropBottom") or s.get("cropBottom") or 0))
            else:
                wanted.setdefault(u, float(s.get("cropBottom") or 0))
    ok = failed = reused = 0
    for url, crop in wanted.items():
        cur = state.get(url)
        if cur and (OUT / cur["file"]).exists() and float(cur.get("cropBottom") or 0) == crop:
            reused += 1
            continue
        try:
            data, ext, w, h = normalize(download(url), crop)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url}: {e}")
            failed += 1
            continue
        file = f"{hashlib.sha256(data).hexdigest()}.{ext}"
        path = OUT / file
        if not path.exists():
            path.write_bytes(data)
        state[url] = {"file": file, "width": w, "height": h, **({"cropBottom": crop} if crop else {})}
        ok += 1
        print(f"  + {file[:10]}… {w}x{h}  {url}")
    # прибираємо записи про URL, яких більше немає в джерелах, і їхні файли, якщо їх ніхто не використовує
    keep_files = {v["file"] for u, v in state.items() if u in wanted}
    for url in list(state):
        if url not in wanted:
            f = OUT / state[url]["file"]
            if state[url]["file"] not in keep_files and f.exists():
                f.unlink()
            del state[url]
    STATE.write_text(json.dumps(dict(sorted(state.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"URL у джерелах: {len(wanted)}; завантажено: {ok}, вже було: {reused}, помилок: {failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
