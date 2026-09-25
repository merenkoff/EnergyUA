#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Витягує зображення, вшиті в xlsx-прайси (data/pricelists), у data/catalog-media/<sha256>.<ext>
і пише data/catalog-media/index.json — де саме (файл, аркуш, рядок, стовпець) кожне фото стояло.
Парсер прайсів (parse_pricelists.py) за цим індексом прив'язує фото до товарів.

Запуск: python3 scripts/pricelists/extract_pricelist_images.py
Залежності: pip install openpyxl pillow

Ім'я файлу = sha256 вмісту + розширення — так само, як у MEDIA_ROOT (див. src/lib/mediaStorage.ts),
тому файли можна просто скопіювати на volume, а в БД записати /api/media/<ім'я>.
Логотипи, бейджі («Wi-Fi», «Новинка», «Klasse M1»), схеми та графіки — у чорному списку BLACKLIST.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import warnings
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
PRICES = ROOT / "data" / "pricelists"
OUT = ROOT / "data" / "catalog-media"

# Перші 10 символів sha256 зображень, які не є фото товару (логотипи, бейджі, банери, схеми, дублі-стопки).
BLACKLIST = {
    # Easytherm / Extherm / Hot Fly: банери й «стопка» з 200 копій одного термостата OJ
    "f8ef008258", "2f08cee8a5", "8eca5c40d0", "ee052acdb5",
    # Heat Plus: бейджі Wi-Fi, «Новинка», логотип, схема підключення, дисплеї
    "6083ef0903", "2a7c232c84", "753763392b", "4e9d0548ac", "e6ca588992", "f3e675c706", "5f8dbe040a",
    "0dd186c9cd", "cbe2731161", "217a936638", "8c6c3611b1", "18e0bb7313", "75b4b4bd2c",
    # In-Therm: логотип Hemstedt, бейджі класу міцності, аерофото, барабан відрізного кабелю, ринва,
    # реклама «voice controlled», фото ламінату, етикетка, графіки/таблиці
    "4e54050874", "e04a55e809", "6cfefdcb50", "08d42bfa50", "109cb37918", "3af8942f77",
    "9cc63af3f9", "83905e49f1", "fb8e67f0a3", "689e405752", "ee367336af", "644c9065e7",
    "5e463acf18", "6f7c1cd497", "7013d63001", "f08ab11f6c",
    # РД: логотипи Nexans / Wärme / Profitherm / OJ / Zuver / AquaBlock, сертифікат ЄС, бейджі
    "fb469790be", "f42db0ee06", "1faff72517", "82265a72ea", "c4cb2fef27", "aa4f2ba2fe", "06e872543c",
    "b356783cc7", "8b975c4c09", "420f571448", "ed5a75035f", "d465c60d71", "174f15b36d",
}
MIN_SIDE = 40  # px: дрібніші — крапки, лінії, іконки
MAX_SIDE = 1200  # px: більші фото зменшуємо, щоб не роздувати репозиторій


def shrink(data: bytes, ext: str) -> tuple[bytes, str]:
    """Зменшує зображення до MAX_SIDE по більшій стороні; PNG з прозорістю лишається PNG."""
    try:
        from PIL import Image
        import io
    except ImportError:
        return data, ext
    im = Image.open(io.BytesIO(data))
    has_alpha = im.mode in ("RGBA", "LA", "P")
    if max(im.size) <= MAX_SIDE and not (ext == "png" and not has_alpha and len(data) > 200_000):
        return data, ext
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    if ext == "png" and has_alpha:
        im.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "png"
    im.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
    return buf.getvalue(), "jpg"


def main() -> None:
    warnings.simplefilter("ignore")
    OUT.mkdir(parents=True, exist_ok=True)
    keep: set[str] = set()
    records: list[dict] = []
    skipped = 0
    for name in sorted(os.listdir(PRICES)):
        if not name.endswith(".xlsx"):
            continue
        wb = openpyxl.load_workbook(PRICES / name)
        for ws in wb.worksheets:
            for im in getattr(ws, "_images", []):
                if im.format not in ("png", "jpeg"):
                    continue
                anchor = getattr(im.anchor, "_from", None)
                if anchor is None:
                    continue
                data = im._data()
                sha = hashlib.sha256(data).hexdigest()
                if sha[:10] in BLACKLIST or min(im.width, im.height) < MIN_SIDE:
                    skipped += 1
                    continue
                ext = "png" if im.format == "png" else "jpg"
                data, ext = shrink(data, ext)
                sha = hashlib.sha256(data).hexdigest()
                file = f"{sha}.{ext}"
                path = OUT / file
                if not path.exists():
                    path.write_bytes(data)
                keep.add(file)
                records.append({
                    "file": file,
                    "source": name,
                    "sheet": ws.title,
                    "row": anchor.row + 1,   # 1-based, як у Excel
                    "col": anchor.col,       # 0-based, як індекс у рядку openpyxl
                    "width": im.width,
                    "height": im.height,
                })
    # прибираємо файли, яких більше немає в жодному прайсі
    for f in OUT.iterdir():
        if f.suffix in (".jpg", ".png") and f.name not in keep:
            f.unlink()
    records.sort(key=lambda r: (r["source"], r["sheet"], r["row"], r["col"], r["file"]))
    (OUT / "index.json").write_text(json.dumps(records, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.iterdir() if f.suffix in (".jpg", ".png"))
    print(f"прив'язок: {len(records)}, унікальних файлів: {len(keep)}, пропущено (чорний список/дрібні): {skipped}, обсяг: {total/1024/1024:.1f} МБ")


if __name__ == "__main__":
    main()
