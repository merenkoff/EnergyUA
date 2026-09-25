#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Завантажує фото товарів з офіційних сайтів брендів для позицій, у прайсах яких фото немає.

Джерела описані вручну в data/catalog-media/external-sources.json:
  [{ "supplier": "ar-ryxon-flex", "brand": "ryxon", "match": {"skuPrefix": ["HM-200-"]},
     "urls": ["https://…/photo.jpg"], "page": "https://…", "note": "…" }, …]
  match — {"skuPrefix": [...]} (артикул починається з рядка, без урахування регістру) або {"sku": [...]} (точно).

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
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ElectroHeat-catalog"


def download(url: str) -> bytes:
    r = subprocess.run(
        ["curl", "-sSL", "--fail", "--max-time", "90", "-A", UA, "-o", "-", url],
        capture_output=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip() or f"curl exit {r.returncode}")
    return r.stdout


def normalize(data: bytes) -> tuple[bytes, str, int, int]:
    """Будь-який формат → jpg (або png, якщо є прозорість), не більше MAX_SIDE по більшій стороні."""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    fmt = (im.format or "").lower()
    if max(im.size) <= MAX_SIDE and fmt in ("jpeg", "png") and not (fmt == "png" and not has_alpha and len(data) > 200_000):
        return data, ("jpg" if fmt == "jpeg" else "png"), im.width, im.height
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    if has_alpha:
        im.convert("RGBA").save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "png", im.width, im.height
    im.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue(), "jpg", im.width, im.height


def main() -> None:
    refresh = "--refresh" in sys.argv
    sources = json.loads(SOURCES.read_text(encoding="utf-8")) if SOURCES.exists() else []
    state: dict[str, dict] = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() and not refresh else {}
    wanted: list[str] = []
    for s in sources:
        for u in s.get("urls", []):
            if u not in wanted:
                wanted.append(u)
    ok = failed = reused = 0
    for url in wanted:
        cur = state.get(url)
        if cur and (OUT / cur["file"]).exists():
            reused += 1
            continue
        try:
            data, ext, w, h = normalize(download(url))
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url}: {e}")
            failed += 1
            continue
        file = f"{hashlib.sha256(data).hexdigest()}.{ext}"
        path = OUT / file
        if not path.exists():
            path.write_bytes(data)
        state[url] = {"file": file, "width": w, "height": h}
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
