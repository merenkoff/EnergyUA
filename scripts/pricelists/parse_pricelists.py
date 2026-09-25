#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер прайсів постачальників → data/catalog/<постачальник>/<sku>.json (один файл = один товар).

Запуск (з кореня репозиторію):
    python3 scripts/pricelists/parse_pricelists.py            # усі прайси
    python3 scripts/pricelists/parse_pricelists.py --only rd  # лише один постачальник

Залежності: pip install openpyxl python-docx pdfplumber

Кожен прайс має власну функцію parse_<supplier>() — формати різні (xlsx, docx, pdf) і
розмітка в кожного своя. Slug-и розділів, міток і брендів беруться з
scripts/lib/pricelistTaxonomy.ts (єдине джерело правди); невідомий slug = помилка.
Формат вихідного JSON описано в scripts/lib/pricelistProduct.ts.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRICES = ROOT / "data" / "pricelists"
OUT = ROOT / "data" / "catalog"
TAXONOMY_TS = ROOT / "scripts" / "lib" / "pricelistTaxonomy.ts"
MEDIA_INDEX = ROOT / "data" / "catalog-media" / "index.json"
EXTERNAL_SOURCES = ROOT / "data" / "catalog-media" / "external-sources.json"
EXTERNAL_STATE = ROOT / "data" / "catalog-media" / "external.json"


class ImageIndex:
    """Фото, витягнуті з прайсів (extract_pricelist_images.py): пошук за файлом/аркушем/рядком/стовпцем
    або за першими символами sha256 (для явних правил у парсерах)."""

    def __init__(self, path: Path):
        self.rows: list[dict] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        self.by_prefix: dict[str, str] = {}
        for r in self.rows:
            self.by_prefix.setdefault(r["file"][:10], r["file"])

    def at(self, source: str, sheet: str, row: int, col: int | None = None) -> list[str]:
        return [r["file"] for r in self.rows if r["source"] == source and r["sheet"] == sheet and r["row"] == row and (col is None or r["col"] == col)]

    def in_rows(self, source: str, sheet: str, row_from: int, row_to: int, min_col: int = 0) -> list[str]:
        """Фото, прив'язані до рядків row_from..row_to (1-based, включно) у стовпцях ≥ min_col."""
        out: list[str] = []
        for r in self.rows:
            if r["source"] == source and r["sheet"] == sheet and row_from <= r["row"] <= row_to and r["col"] >= min_col and r["file"] not in out:
                out.append(r["file"])
        return out

    def by_hash(self, *prefixes: str) -> list[str]:
        out = []
        for pfx in prefixes:
            f = self.by_prefix.get(pfx)
            if f and f not in out:
                out.append(f)
        return out


class ExternalImages:
    """Фото з офіційних сайтів (fetch_external_images.py) для товарів, у прайсі яких фото немає.
    Правило з external-sources.json: точний артикул (match.sku) або префікс артикула (match.skuPrefix, без регістру);
    з кількох збігів перемагає точний, далі — найдовший префікс."""

    def __init__(self, sources: Path, state: Path):
        self.rules: list[dict] = json.loads(sources.read_text(encoding="utf-8")) if sources.exists() else []
        st = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
        self.file_by_url: dict[str, str] = {u: v["file"] for u, v in st.items()}

    def for_product(self, supplier: str, sku: str) -> list[str]:
        best: tuple[int, int, list[str]] | None = None
        low = sku.lower()
        for i, r in enumerate(self.rules):
            if r.get("supplier") != supplier or not r.get("urls"):
                continue
            m = r.get("match", {})
            score = -1
            if sku in m.get("sku", []):
                score = 10_000
            else:
                for p in m.get("skuPrefix", []):
                    if low.startswith(p.lower()):
                        score = max(score, len(p))
            if score >= 0 and (best is None or score > best[0]):
                best = (score, i, r["urls"])
        if best is None:
            return []
        out: list[str] = []
        for u in best[2]:
            f = self.file_by_url.get(u["url"] if isinstance(u, dict) else u)
            if f and f not in out:
                out.append(f)
        return out


MEDIA = ImageIndex(MEDIA_INDEX)
EXTERNAL = ExternalImages(EXTERNAL_SOURCES, EXTERNAL_STATE)

# ---------------------------------------------------------------------------
# Таксономія (читаємо slug-и з TS-файлу, щоб не дублювати списки)
# ---------------------------------------------------------------------------


def load_taxonomy():
    text = TAXONOMY_TS.read_text(encoding="utf-8")
    sections = re.findall(r'slug:\s*"([a-z0-9-]+)",\s*\n\s*nameUk', text)
    tags = re.findall(r'\["([a-z0-9-]+)",\s*"', text)
    brands = re.findall(r'\{\s*slug:\s*"([a-z0-9-]+)",\s*name:\s*"([^"]+)"(?:,\s*country:\s*"([a-z-]+)")?', text)
    brand_country = {slug: country or None for slug, _name, country in brands}
    return set(sections), set(tags), brand_country


SECTIONS, TAGS, BRAND_COUNTRY = load_taxonomy()
if not SECTIONS or not TAGS or not BRAND_COUNTRY:
    sys.exit("Не вдалося прочитати таксономію з " + str(TAXONOMY_TS))

BRAND_NAMES = {
    "arnold-rak": "Arnold Rak",
    "ryxon": "Ryxon",
    "flex": "Flex",
    "heat-plus": "Heat Plus",
    "smart": "SMART",
    "hemstedt": "Hemstedt",
    "fenix": "Fenix",
    "in-therm": "IN-THERM",
    "eberle": "Eberle",
    "eltrace": "Eltrace",
    "deye": "Deye",
    "bluetti": "Bluetti",
    "bluesun": "Bluesun",
    "allpowers": "Allpowers",
    "hysincere": "Hysincere",
    "mfuzop": "MFUZOP",
    "datou-boss": "Datou Boss",
    "dyness": "Dyness",
    "nexans": "Nexans",
    "warme": "Wärme",
    "profitherm": "Profi Therm",
    "oj-electronics": "OJ Electronics",
    "zuver": "Zuver",
    "akvablok": "Акваблок",
    "extherm": "Extherm",
    "easytherm": "Easytherm",
    "hot-fly": "Hot Fly",
    "shtoller": "Shtoller",
    "magnum": "Magnum",
    "hts-global": "HTS Global",
    "mhw": "MHW",
    "terneo": "Terneo",
    "ecoterm": "EcoTerm",
    "castle": "Castle",
}

COUNTRY_TAG = {
    "німеччина": "nimechchyna",
    "чехія": "chekhiia",
    "нідерланди": "niderlandy",
    "норвегія": "norvehiia",
    "данія": "daniia",
    "франція": "frantsiia",
    "франция": "frantsiia",
    "швейцарія": "shveitsariia",
    "польща": "polshcha",
    "латвія": "latviia",
    "корея": "koreia",
    "україна": "ukraina",
    "китай": "kytai",
}

# ---------------------------------------------------------------------------
# Допоміжні
# ---------------------------------------------------------------------------

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie", "ж": "zh", "з": "z",
    "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
    "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ь": "", "ю": "iu", "я": "ia", "ы": "y", "э": "e", "ё": "e", "ъ": "",
}
# Кирилиця, схожа на латиницю, всередині артикулів (ВНТ-100 → BHT-100)
_LOOKALIKE = str.maketrans("АВЕКМНОРСТХІУ" + "авекмнорстху", "ABEKMHOPCTXIY" + "abekmhopctxy")


def slugify(s: str) -> str:
    s = s.strip().lower()
    out = []
    for ch in s:
        if ch in _TRANSLIT:
            out.append(_TRANSLIT[ch])
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        elif ch in "²":
            out.append("2")
        elif ch == "+":
            out.append("-plus")
        else:
            out.append("-")
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def fix_sku(s: str) -> str:
    """Артикул: прибираємо зайві пробіли, кириличні двійники латинських літер."""
    s = re.sub(r"\s+", " ", str(s)).strip()
    s = re.sub(r"\s*-\s*", "-", s)
    tokens = []
    for tok in s.split(" "):
        if re.search(r"[0-9A-Za-z]", tok):
            tokens.append(tok.translate(_LOOKALIKE))
        else:
            tokens.append(tok)
    return " ".join(tokens)


def num(v) -> float | None:
    """'0,5 м²' → 0.5; '4,950.00' → 4950; 1050.0 → 1050. Текст, що не починається з числа, → None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", " ")
    if not s:
        return None
    # число на початку; після нього — лише одиниця без цифр («0,5 м²», «2790 *», «550 грн/м кв.»)
    m = re.match(r"^[-–]?\s*(\d[\d\s]*(?:[.,]\d+)?)\s*[^\d]{0,40}$", s)
    if not m:
        return None
    t = m.group(1).replace(" ", "")
    if "," in t and "." in t:
        t = t.replace(",", "")
    else:
        t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def money(v) -> int | None:
    n = num(v)
    if n is None or n <= 0:
        return None
    return int(round(n))


def fmt(n: float | None, digits: int = 2) -> str:
    """Число в українському форматі: 1.5 → '1,5', 2.0 → '2'."""
    if isinstance(n, str):
        n = num(n)
    if n is None:
        return ""
    s = f"{n:.{digits}f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def text(v) -> str:
    if v is None:
        return ""
    return re.sub(r"[ \t]+", " ", str(v).replace(" ", " ")).strip()


def cell(row, i):
    return row[i] if i < len(row) else None


def spec(slug: str, label: str, value, number=None, unit=None) -> dict:
    if number is None and isinstance(value, (int, float)):
        number = float(value)
    if isinstance(value, float):
        value = fmt(value)
    return {"slug": slug, "labelUk": label, "value": str(value), "number": number, "unit": unit}


# Стандартні характеристики (slug → (назва, одиниця))
S = {
    "power_w": ("Потужність", "Вт"),
    "power_w_m2": ("Питома потужність", "Вт/м²"),
    "power_w_m": ("Погонна потужність", "Вт/м"),
    "area_m2": ("Площа обігріву", "м²"),
    "area_range_m2": ("Площа обігріву (діапазон)", "м²"),
    "length_m": ("Довжина кабелю", "м"),
    "size_m": ("Розмір мату", "м"),
    "resistance_ohm": ("Опір", "Ом"),
    "cable_diameter_mm": ("Діаметр кабелю", "мм"),
    "cold_lead_m": ("Кабель живлення", "м"),
    "cores": ("Кількість жил", None),
    "inner_insulation": ("Внутрішня ізоляція", None),
    "outer_insulation": ("Зовнішня ізоляція", None),
    "connection": ("З’єднання", None),
    "warranty": ("Гарантія", None),
    "voltage_v": ("Напруга", "В"),
    "max_load_a": ("Макс. навантаження", "А"),
    "temp_range": ("Діапазон температур", "°C"),
    "ip": ("Ступінь захисту", None),
    "mounting": ("Монтаж", None),
    "display": ("Дисплей", None),
    "type": ("Тип", None),
    "color": ("Колір", None),
    "country": ("Країна виробництва", None),
    "tape_m": ("Монтажна стрічка на комплект", "м"),
    "dimensions": ("Розміри", None),
    "weight_kg": ("Вага", "кг"),
    "max_length_m": ("Макс. довжина секції", "м"),
    "unit": ("Одиниця", None),
    "model": ("Модель", None),
    "series": ("Серія", None),
    "certification": ("Сертифікація", None),
    "laying_step_m": ("Крок укладання", "м"),
    "mat_width_m": ("Ширина мату", "м"),
    "thickness_mm": ("Товщина", "мм"),
    "roll_width_m": ("Ширина рулону", "м"),
    "capacity_ah": ("Ємність", "А·год"),
    "capacity_wh": ("Ємність", "Вт·год"),
    "peak_power_w": ("Пікова потужність", "Вт"),
    "battery_type": ("Тип акумулятора", None),
    "phases": ("Фази", None),
    "sensor_floor": ("Датчик підлоги", None),
    "sensor_air": ("Датчик повітря", None),
    "adaptive": ("Адаптивна функція", None),
    "compat": ("Сумісність з рамками", None),
    "zones": ("Кількість зон", None),
    "purpose": ("Призначення", None),
    "protocol": ("Протокол", None),
    "power_supply": ("Живлення", None),
    "step": ("Крок фіксації", None),
    "application": ("Застосування", None),
}


def sp(slug: str, value, number=None) -> dict:
    label, unit = S[slug]
    return spec(slug, label, value, number, unit)


def power_tag_m2(w) -> str | None:
    n = num(w)
    if n is None:
        return None
    t = f"{int(round(n))}-vt-m2"
    return t if t in TAGS else None


def power_tag_m(w) -> str | None:
    n = num(w)
    if n is None:
        return None
    t = fmt(n).replace(",", "-") + "-vt-m"
    return t if t in TAGS else None


def country_tag(name: str | None) -> str | None:
    if not name:
        return None
    return COUNTRY_TAG.get(text(name).lower())


# ---------------------------------------------------------------------------
# Збирач товарів
# ---------------------------------------------------------------------------


class Writer:
    def __init__(self, supplier: str, supplier_name: str, file: str, date: str):
        self.supplier = supplier
        self.supplier_name = supplier_name
        self.file = file
        self.date = date
        self.products: dict[str, dict] = {}
        self.warnings: list[str] = []

    def warn(self, msg: str):
        self.warnings.append(msg)

    def add(
        self,
        *,
        sku: str,
        name: str,
        brand: str | None,
        category: str,
        tags,
        price,
        kit=None,
        unit: str = "шт",
        price_note: str | None = None,
        short: str | None = None,
        description: str | None = None,
        specs=None,
        sheet: str | None = None,
        page: int | None = None,
        sku_suffix: str | None = None,
        images: list[str] | None = None,
        row: int | None = None,
    ):
        sku = fix_sku(sku)
        if category not in SECTIONS:
            raise ValueError(f"[{self.supplier}] невідомий розділ {category!r} для {sku}")
        if brand is not None and brand not in BRAND_COUNTRY:
            raise ValueError(f"[{self.supplier}] невідомий бренд {brand!r} для {sku}")
        tag_list: list[str] = []
        for t in list(tags or []) + ([BRAND_COUNTRY.get(brand)] if brand else []):
            if not t:
                continue
            if t not in TAGS:
                raise ValueError(f"[{self.supplier}] невідома мітка {t!r} для {sku}")
            if t not in tag_list:
                tag_list.append(t)
        if kit is not None and "z-komplektom" not in tag_list:
            tag_list.append("z-komplektom")
        key = slugify(sku + (("-" + sku_suffix) if sku_suffix else ""))
        if not key:
            raise ValueError(f"[{self.supplier}] порожній артикул: {name}")
        if key in self.products:
            self.warn(f"дубль артикула {sku} ({name}) — пропущено")
            return
        price_uah = money(price)
        kit_uah = money(kit) if kit is not None else None
        # Фото: явний список, інакше — те, що стояло в цьому ж рядку прайсу
        if images is None and row is not None and sheet:
            images = MEDIA.at(self.file, sheet, row)
        images = self.override_images(sku, images or [])
        if not images:
            images = EXTERNAL.for_product(self.supplier, sku)
        clean_specs = []
        for s_ in specs or []:
            if s_ is None or s_["value"] in ("", "None"):
                continue
            if s_["slug"] in {x["slug"] for x in clean_specs}:
                continue
            clean_specs.append(s_)
        self.products[key] = {
            "id": f"{self.supplier}/{key}",
            "supplier": self.supplier,
            "brand": brand,
            "sku": sku,
            "nameUk": re.sub(r"\s+", " ", name).strip(),
            "category": category,
            "tags": tag_list,
            "priceUah": price_uah,
            "priceKitUah": kit_uah,
            "priceUnit": unit,
            "priceNote": price_note,
            "shortDescription": short,
            "description": description,
            "specs": clean_specs,
            "images": [{"file": f, "alt": re.sub(r"\s+", " ", name).strip()} for f in images],
            "source": {
                "file": f"data/pricelists/{self.file}",
                **({"sheet": sheet} if sheet else {}),
                **({"page": page} if page else {}),
                "date": self.date,
                "supplierName": self.supplier_name,
            },
        }

    # Явні правила «артикул/префікс → фото» для позицій, де фото в прайсі стоїть не в рядку товару.
    IMAGE_RULES: dict[str, list[tuple[str, list[str]]]] = {
        "rd": [
            ("TXLP/2R", ["f94eb2f097"]), ("MILLIMAT", ["0fcb7d7219"]),
            ("Wärme Twin flex", ["a33f6b8459"]), ("Wärme Twin mat", ["a91fc97f14"]),
            ("PROFI THERM 2 ", ["4aebb4f531"]), ("PROFI THERM 150", ["778a367183"]),
            ("PROFI THERM Eko-2", ["ebf922b0be"]), ("PROFI THERM Eko Flex", ["ebf922b0be"]), ("PROFI THERM Eko mat", ["eda4df5bd3"]),
            ("ZUVER 4.4", ["33911b3295"]), ("Стержень заземлення н/ж безмуфтовий з накінечником", ["33911b3295"]),
            ("Profitherm-MEX Black", ["4133973908"]), ("Profitherm-MEX", ["cd257b6f0d"]), ("Wärme Technik М", ["22e3e19e1b"]), ("Комплект Акваблок", ["77cdfb91e2"]), ("Датчик Акваблок", ["77cdfb91e2"]),
            ("Стрічка електромонтажна", ["dff2334855"]), ("Труба гофрована", ["89be7328d0"]),
        ],
        "in-therm": [
            ("ZVP Датчик", ["08d4c35707"]), ("ZVP", ["ff420bd947"]),
            ("ECOSUN S+ bracket", ["1491f63a98"]),
            ("TRACECO", ["cc437d3c9f"]), ("SRL", ["cc437d3c9f"]),
        ],
        "easytherm-extherm": [
            ("55531", ["a12e721e07"]), ("55532", ["90ffefe986"]),
            ("55533", ["ebf4e5b1ce"]), ("55534", ["03f770b5be"]), ("55535", ["38614748dd"]),
            ("55527", ["9a028b39c8"]),
            ("55519", ["f88ce01a04", "f68787581d", "6596383a70", "3d01e73a47", "624b812d31"]),
        ],
    }

    def override_images(self, sku: str, images: list[str]) -> list[str]:
        for prefix, hashes in self.IMAGE_RULES.get(self.supplier, []):
            if sku.lower().startswith(prefix.lower()):
                return MEDIA.by_hash(*hashes)
        return images

    def flush(self):
        d = OUT / self.supplier
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        for key, p in self.products.items():
            (d / f"{key}.json").write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with_price = sum(1 for p in self.products.values() if p["priceUah"])
        with_img = sum(1 for p in self.products.values() if p["images"])
        print(f"[{self.supplier}] {len(self.products)} товарів ({with_price} з ціною, {with_img} з фото) → {d.relative_to(ROOT)}")
        for w in self.warnings:
            print(f"   ! {w}")


def load_xlsx(name: str):
    import openpyxl
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return openpyxl.load_workbook(PRICES / name, data_only=True)


def grid(ws) -> list[list]:
    return [list(r) for r in ws.iter_rows(values_only=True)]


def desc_html(lines) -> str | None:
    items = [text(x) for x in lines if text(x)]
    if not items:
        return None
    return "".join(f"<p>{x}</p>" for x in items)


def bullets_html(lines) -> str | None:
    items = [re.sub(r"^\d+[.)]\s*", "", text(x)) for x in lines if text(x)]
    if not items:
        return None
    return "<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>"


# ---------------------------------------------------------------------------
# 1. Heat Plus — терморегулятори та рушникосушарки
# ---------------------------------------------------------------------------


def _color_spec(name: str) -> dict | None:
    colors = []
    for k, v in (
        ("біл", "білий"), ("чорн", "чорний"), ("сір", "сірий"), ("золот", "золото"), ("срібн", "срібний"),
        ("графіт", "графіт"), ("біжев", "бежевий"), ("дзеркальн", "дзеркальний"),
    ):
        if k in name.lower() and v not in colors:
            colors.append(v)
    return sp("color", ", ".join(colors)) if colors else None


def _thermostat_tags(*texts: str) -> list[str]:
    t = " ".join(texts).lower()
    tags = []
    if re.search(r"механічн|аналогов|біметал", t):
        tags.append("mekhanichnyi")
    if "цифров" in t:
        tags.append("tsyfrovyi")
    if re.search(r"(?<!не )програм", t):
        tags.append("prohramovanyi")
    if "сенсорн" in t:
        tags.append("sensornyi")
    if re.search(r"wi\s*-?\s*fi", t):
        tags.append("wi-fi")
    if "zigbee" in t:
        tags.append("zigbee")
    if "din" in t:
        tags.append("din-reika")
    if "двозонн" in t:
        tags.append("dvozonnyi")
    if "газов" in t:
        tags.append("dlia-hazovoho-kotla")
    return tags


def parse_heat_plus():
    W = Writer("heat-plus", "Heat Plus (прайс 05.2026)", "2026-05-heat-plus.xlsx", "2026-05-01")
    wb = load_xlsx(W.file)
    ws = wb["Терморегулятори Heat_Plus"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        raw = text(cell(row, 3))
        if not raw or raw.startswith("Терморегулятори"):
            continue
        price = cell(row, 10)
        typ = text(cell(row, 4))
        feat = text(cell(row, 5))
        size = text(cell(row, 8))
        rng = text(cell(row, 9))
        if raw.startswith(("Зовнішній датчик", "KSD")):
            sku = "KSD-9700-060-N" if raw.startswith("KSD") else re.sub(r".*сенсор\s+", "", raw.split(",")[0])
            W.add(row=rn, 
                sku=sku, name=raw.split(";")[0] if raw.startswith("KSD") else raw, brand="heat-plus",
                category="montazh-ta-aksesuary", tags=["datchyk-pidlohy"] if "датчик" in raw.lower() else [],
                price=price, sheet=ws.title, description=desc_html([raw]),
            )
            continue
        head = re.split(r",|;", raw, maxsplit=1)[0]
        head = re.sub(r"^Термостат\s+", "", head)
        head = re.split(r"\s(сенсорний|білий|чорний|накладний|керування|двозонний|WiFI|WIFI|з WI)", head, maxsplit=1)[0]
        head = re.sub(r"\s*-\s*$", "", head)
        sku = fix_sku(head)
        wifi = bool(re.search(r"wi\s*-?\s*fi", raw + " " + typ, re.I))
        tags = _thermostat_tags(raw, typ)
        if "wi-fi" in tags and not wifi:
            tags.remove("wi-fi")
        load = re.search(r"(\d{2})\s?[AА]\b", raw)
        specs = [
            sp("type", typ) if typ else None,
            sp("max_load_a", load.group(1) if load else "16", float(load.group(1)) if load else 16.0),
            sp("dimensions", size) if size else None,
            sp("temp_range", rng) if rng else None,
            _color_spec(raw),
        ]
        raw_clean = re.sub(r"^Термостат\s+", "", raw)
        head_clean = re.sub(r"^Термостат\s+", "", head)
        name = "Терморегулятор Heat Plus " + (sku + raw_clean[len(head_clean):] if raw_clean.startswith(head_clean) else raw_clean)
        W.add(row=rn, 
            sku=sku, sku_suffix="wifi" if wifi and not re.search(r"wi\s*-?\s*fi", head, re.I) else None,
            name=name, brand="heat-plus", category="termorehuliatory", tags=tags, price=price,
            specs=specs, sheet=ws.title, short=typ or None, description=desc_html([feat]),
        )

    ws = wb["Рушникосушарки"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        if num(cell(row, 0)) is None or not text(cell(row, 2)):
            continue
        sku = fix_sku(text(cell(row, 2)))
        name = re.sub(r"\s*\(\s*Код УКТЗЕД.*$", "", text(cell(row, 5)))
        name = re.sub(r"(XN-\s*(?:WH|BK|QH)\s*\d+\s*(?:N|G)?|WH303)\s*", sku + " ", name, count=1)
        name = name.replace("Електрична рушникосушарка", "Електрична рушникосушарка Heat Plus")
        W.add(row=rn, 
            sku=sku, name=name, brand="heat-plus", category="rushnykosusharky", tags=["vanna"],
            price=cell(row, 20), specs=[_color_spec(name)], sheet=ws.title,
        )
    W.flush()


# ---------------------------------------------------------------------------
# 2. Arnold Rak / Ryxon / Flex (прайс 08.06.2026)
# ---------------------------------------------------------------------------

AR_COMMON = [
    sp("voltage_v", "230", 230.0),
    sp("inner_insulation", "FEP (тефлон)"),
    sp("outer_insulation", "ПВХ, екран — алюмінієва фольга"),
]


def _mat_name(brand: str, series: str, sku: str, area, power, density) -> str:
    return f"Нагрівальний мат {brand} {series} {sku} — {fmt(area)} м², {fmt(power)} Вт ({fmt(density)} Вт/м²)"


def _cable_name(brand: str, series: str, sku: str, length, power, linear) -> str:
    return f"Нагрівальний кабель {brand} {series} {sku} — {fmt(length)} м, {fmt(power)} Вт ({fmt(linear)} Вт/м)"


def parse_ar_ryxon_flex():
    W = Writer("ar-ryxon-flex", "Arnold Rak / Ryxon / Flex (прайс 08.06.2026)", "2026-06-08-arnold-rak-ryxon-flex.xlsx", "2026-06-08")
    wb = load_xlsx(W.file)

    # --- Premium Arnold Rak: мати FH L / FH P, кабель 61xx-20 / 61xx-30, килимки
    ws = wb["Premium_AR_кабель_мати"]
    section = ""
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = [(i, v) for i, v in enumerate(row) if text(v)]
        if len(vals) == 1 and isinstance(vals[0][1], str) and len(text(vals[0][1])) > 12:
            section = text(vals[0][1])
            continue
        sku = text(cell(row, 2))
        if not sku or num(cell(row, 1)) is None:
            continue
        power, size, area, price, kit = cell(row, 3), text(cell(row, 4)), num(cell(row, 5)), cell(row, 6), cell(row, 7)
        if re.search(r"FH L", section):
            W.add(row=rn, sku=sku, name=_mat_name("Arnold Rak", "Premium", sku, area, power, 200), brand="arnold-rak",
                  category="nahrivalni-maty", tags=["pid-laminat", "odnozhylnyi", "200-vt-m2"], price=price, kit=kit,
                  specs=[sp("power_w", power), sp("area_m2", area), sp("size_m", size), sp("power_w_m2", 200.0), sp("cores", "одножильний"), *AR_COMMON],
                  short="Одножильний мат серії Premium для сухого монтажу під ламінат (у нівелюючу суміш).", sheet=ws.title)
        elif re.search(r"FH P", section):
            W.add(row=rn, sku=sku, name=_mat_name("Arnold Rak", "Premium", sku, area, power, 200), brand="arnold-rak",
                  category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "200-vt-m2"], price=price, kit=kit,
                  specs=[sp("power_w", power), sp("area_m2", area), sp("size_m", size), sp("power_w_m2", 200.0), sp("cores", "двожильний"), *AR_COMMON],
                  short="Двожильний мат серії Premium 200 Вт/м² для укладання в плитковий клей.", sheet=ws.title)
        elif re.search(r"61xx-20", section):
            W.add(row=rn, sku=sku, name=_cable_name("Arnold Rak", "Premium", sku, num(size), power, 20), brand="arnold-rak",
                  category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "20-vt-m"], price=price, kit=kit,
                  specs=[sp("power_w", power), sp("length_m", num(size)), sp("power_w_m", 20.0), sp("cores", "двожильний"), *AR_COMMON],
                  short="Двожильний кабель серії Premium 20 Вт/м для укладання в стяжку.", sheet=ws.title)
        elif re.search(r"61xx-30", section):
            W.add(row=rn, sku=sku, name=_cable_name("Arnold Rak", "Premium", sku, num(size), power, 30), brand="arnold-rak",
                  category="antyobledeninnia", tags=["vidkryti-maidanchyky", "vodostoky-ta-pokrivlia", "dvozhylnyi", "30-vt-m"], price=price, kit=kit,
                  specs=[sp("power_w", power), sp("length_m", num(size)), sp("power_w_m", 30.0), sp("cores", "двожильний"), *AR_COMMON],
                  short="Двожильний кабель 30 Вт/м для зовнішнього обігріву: сходи, доріжки, водостоки.", sheet=ws.title)
        elif re.search(r"Килимки|Сушка", section):
            if money(price) is None:
                continue
            kind = "Сушарка для взуття" if "Сушка" in section else "Килимок з підігрівом"
            brand = "arnold-rak" if "Arnold" in section or "Heat Master" in section else None
            W.add(row=rn, sku=sku, name=f"{kind} {'Arnold Rak ' if brand else ''}{sku} — {size} м, {fmt(num(power))} Вт", brand=brand,
                  category="kylymky-z-pidihrivom", tags=["dlia-domu"], price=price,
                  specs=[sp("power_w", power), sp("size_m", size), sp("area_m2", area)], sheet=ws.title)

    # --- Standart Arnold Rak: мати FH-EC 180 Вт/м²
    ws = wb["Standart_AR_мати"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        sku = text(cell(row, 1))
        if not sku.startswith("FH-EC"):
            continue
        area = num(cell(row, 4))
        W.add(row=rn, sku=sku, name=_mat_name("Arnold Rak", "Standart", sku, area, cell(row, 3), 180), brand="arnold-rak",
              category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "180-vt-m2"], price=cell(row, 5), kit=cell(row, 6),
              specs=[sp("power_w", cell(row, 3)), sp("area_m2", area), sp("size_m", text(cell(row, 2))), sp("power_w_m2", 180.0),
                     sp("cores", "двожильний"), sp("cable_diameter_mm", 2.8), sp("ip", "IP X7, клас захисту II"), *AR_COMMON],
              short="Двожильний мат Standart 180 Вт/м², діаметр кабелю 2,8 мм, для укладання в плитковий клей.", sheet=ws.title)

    # --- Standart кабель 20 Вт/м та 15 Вт/м
    for sheet_name, offset, linear, diam in (("Standart_AR_кабель 20 Вт", 0, 20.0, 5.0), ("Standart_AR_кабель 15 Вт", 1, 15.0, 5.0)):
        ws = wb[sheet_name]
        for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
            sku = text(cell(row, 1 + offset))
            if not re.match(r"^\d{4}-\d{2}", sku):
                continue
            length = num(cell(row, 2 + offset))
            W.add(row=rn, sku=sku, name=_cable_name("Arnold Rak", "Standart", sku, length, cell(row, 4 + offset), linear), brand="arnold-rak",
                  category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", power_tag_m(linear)], price=cell(row, 5 + offset), kit=cell(row, 6 + offset),
                  specs=[sp("power_w", cell(row, 4 + offset)), sp("length_m", length), sp("area_range_m2", text(cell(row, 3 + offset))),
                         sp("power_w_m", linear), sp("cores", "двожильний"), sp("cable_diameter_mm", diam),
                         sp("tape_m", cell(row, 7 + offset)), *AR_COMMON],
                  short=f"Двожильний кабель Standart {fmt(linear)} Вт/м для укладання в стяжку. Комплект: кабель + гофра + коробка.", sheet=ws.title)

    # --- Терморегулятор Arnold Rak
    ws = wb["Терморегулятори AR"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        sku = text(cell(row, 1))
        if sku.startswith("AR ") and money(cell(row, 5)):
            W.add(row=rn, sku=sku, name=f"Терморегулятор Arnold Rak {sku} з датчиком підлоги", brand="arnold-rak", category="termorehuliatory",
                  tags=["mekhanichnyi", "datchyk-pidlohy"], price=cell(row, 5),
                  specs=[sp("max_load_a", "16", 16.0), sp("voltage_v", "230", 230.0), sp("color", text(cell(row, 4)))],
                  short=text(cell(row, 2)), sheet=ws.title)

    # --- Ryxon / Flex: кабель, мати, саморег
    for brand, cab_sheet, mat_sheet, sr_sheet, linear, density, diam in (
        ("ryxon", "RYXON_кабель", "RYXON_мати", "RYXON_самрег_", 20.0, 200.0, 3.6),
        ("flex", "FLEX_кабель ", "FLEX_мати", "FLEX_самрег_ ", 17.5, 175.0, 4.0),
    ):
        bn = BRAND_NAMES[brand]
        ws = wb[cab_sheet]
        for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
            sku = text(cell(row, 0))
            if not re.match(r"^(HC|EHC)", sku) or money(cell(row, 5)) is None:
                continue
            length = num(cell(row, 1))
            W.add(row=rn, sku=sku, name=_cable_name(bn, "", sku, length, cell(row, 2), linear).replace("  ", " "), brand=brand,
                  category="nahrivalnyi-kabel", tags=["pid-plytku", "u-stiazhku", "tonkyi-kabel", "dvozhylnyi", power_tag_m(linear)],
                  price=cell(row, 5), kit=cell(row, 6),
                  specs=[sp("power_w", cell(row, 2)), sp("length_m", length), sp("area_m2", num(cell(row, 3))),
                         sp("area_range_m2", f"{text(cell(row, 3))} – {text(cell(row, 4))}"), sp("power_w_m", linear),
                         sp("cable_diameter_mm", diam), sp("cores", "двожильний"), sp("tape_m", cell(row, 7))],
                  short=f"Тонкий двожильний кабель {fmt(linear)} Вт/м, Ø {fmt(diam)} мм — у плитковий клей або стяжку. Комплект: кабель + гофра + коробка.",
                  sheet=ws.title)
        ws = wb[mat_sheet]
        for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
            sku = text(cell(row, 0))
            if not re.match(r"^(HM|EHM)", sku) or money(cell(row, 4)) is None:
                continue
            area = num(cell(row, 3))
            W.add(row=rn, sku=sku, name=_mat_name(bn, "", sku, area, cell(row, 2), density).replace("  ", " "), brand=brand,
                  category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", power_tag_m2(density)], price=cell(row, 4), kit=cell(row, 5),
                  specs=[sp("power_w", cell(row, 2)), sp("area_m2", area), sp("size_m", text(cell(row, 1))), sp("power_w_m2", density),
                         sp("cable_diameter_mm", diam), sp("cores", "двожильний")],
                  short=f"Двожильний нагрівальний мат {fmt(density)} Вт/м², Ø {fmt(diam)} мм. Комплект: мат + гофра + коробка.", sheet=ws.title)
        ws = wb[sr_sheet]
        for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
            sku = text(cell(row, 0))
            if not re.match(r"^(LSR|FLSR)", sku) or money(cell(row, 3)) is None:
                continue
            w_m = re.search(r"(\d+)\s*Вт", text(cell(row, 1)))
            fep = "FEP" in text(cell(row, 1))
            W.add(row=rn, sku=sku, name=f"Саморегулюючий кабель {bn} {sku}, {w_m.group(1) if w_m else '?'} Вт/м{' (FEP)' if fep else ''}", brand=brand,
                  category="samorehuliuiuchyi-kabel", tags=["truby", "vodostoky-ta-pokrivlia", "vidriznyi"], price=cell(row, 3), unit="м",
                  specs=[sp("power_w_m", float(w_m.group(1))) if w_m else None, sp("outer_insulation", "FEP" if fep else "полімер")],
                  short="Саморегулюючий кабель для захисту труб і водостоків від замерзання. Ціна за погонний метр.", sheet=ws.title)

    # --- Кріплення та монтажна стрічка
    ws = wb["Кріплення"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        name = text(cell(row, 1))
        if not name or money(cell(row, 3)) is None or name.startswith("НАЙМЕНУВАННЯ"):
            continue
        name = name.capitalize()
        unit = "м" if "пог" in text(cell(row, 2)) else "шт"
        tags = ["vodostoky-ta-pokrivlia"] if "ВОДОСТОК" in text(cell(row, 1)) else []
        W.add(row=rn, sku=name, name=name, brand=None, category="montazh-ta-aksesuary", tags=tags, price=cell(row, 3), unit=unit,
              specs=[sp("unit", text(cell(row, 2)))], sheet=ws.title)

    # --- Терморегулятори FLEX
    ws = wb["FLEX_Терморегулятори"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        sku = text(cell(row, 1))
        if not re.match(r"^TD", sku):
            continue
        app, tech = text(cell(row, 2)), text(cell(row, 3))
        outdoor = "сніготан" in app.lower()
        W.add(row=rn, sku=sku, name=f"Терморегулятор Flex {sku}" + (" для систем сніготанення" if outdoor else ""), brand="flex",
              category="antyobledeninnia" if outdoor else "termorehuliatory",
              tags=["din-reika", "dlia-snihotanennia"] if outdoor else ["tsyfrovyi", "datchyk-pidlohy"], price=cell(row, 4),
              short=app, description=desc_html([tech]), sheet=ws.title)
    W.flush()


# ---------------------------------------------------------------------------
# 3. IN-THERM (Hemstedt, Fenix, IN-THERM, термостати, плівка, саморег, енергетика…)
# ---------------------------------------------------------------------------

# Блоки з таблицями «Потужність | Довжина | Площа… | Ціна | Ціна комплекту» — реєстр за заголовком.
# kind: mat | cable | alu | pipe
IT_BLOCKS = [
    # HEMSTEDT
    dict(title=r"Нагрівальний мат Hemstedt DH 150", brand="hemstedt", series="DH", kind="mat", density=150,
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "bezmuftove-ziednannia", "ftoroplastova-izoliatsiia"]),
    dict(title=r"кабель Hemstedt DR 12,5", brand="hemstedt", series="DR", kind="cable", linear=12.5,
         category="nahrivalnyi-kabel", tags=["pid-plytku", "tonkyi-kabel", "dvozhylnyi", "bezmuftove-ziednannia", "ftoroplastova-izoliatsiia"]),
    dict(title=r"кабель двожильний Hemstedt BR-IM 17", brand="hemstedt", series="BR-IM", kind="cable", linear=17,
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "bezmuftove-ziednannia"]),
    dict(title=r"кабель одножильний Hemstedt BR-IM-Z", images=['7128bc6682'], brand="hemstedt", series="BR-IM-Z", kind="cable", linear=17,
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "odnozhylnyi", "bezmuftove-ziednannia"]),
    dict(title=r"Hemstedt BRF-IM 27", brand="hemstedt", series="BRF-IM", kind="cable", linear=27,
         category="antyobledeninnia", tags=["vodostoky-ta-pokrivlia", "vidkryti-maidanchyky", "dvozhylnyi"]),
    dict(title=r"Hemstedt DAS 30", brand="hemstedt", series="DAS", kind="pipe", linear=30,
         category="antyobledeninnia", tags=["truby", "vodostoky-ta-pokrivlia", "z-vbudovanym-termostatom"]),
    dict(title=r"Hemstedt FS 10", brand="hemstedt", series="FS", kind="pipe", linear=10,
         category="antyobledeninnia", tags=["truby", "z-vbudovanym-termostatom"]),
    # HEMSTEDT DI SI
    dict(title=r"Нагрівальний мат Hemstedt Di Si H", images=["78622891e5"], brand="hemstedt", series="Di Si H", kind="mat", density=150,
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "samokleiucha-sitka", "bezmuftove-ziednannia", "ftoroplastova-izoliatsiia"]),
    dict(title=r"кабель Hemstedt Di Si R", images=["d6cc2b47ae"], brand="hemstedt", series="Di Si R", kind="cable", linear=12.5,
         category="nahrivalnyi-kabel", tags=["pid-plytku", "tonkyi-kabel", "dvozhylnyi", "bezmuftove-ziednannia", "ftoroplastova-izoliatsiia"]),
    # FENIX ULTRA
    dict(title=r"Ультратонкий нагрівальний мат Fenix", brand="fenix", series="Ultra CM", kind="mat", density=150,
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "ultratonkyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Ультратонкий нагрівальний кабель Fenix", images=['549e33637c'], brand="fenix", series="Ultra ADSA", kind="cable", linear=12,
         category="nahrivalnyi-kabel", tags=["pid-plytku", "ultratonkyi", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    # FENIX
    dict(title=r"Нагрівальний мат Fenix\s*LDTS 160", brand="fenix", series="LDTS", kind="mat", density=160,
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Нагрівальний мат Fenix LDTS M 160", images=['71c1ad079b'], brand="fenix", series="LDTS M", kind="mat", density=160,
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Тонкий двожильний кабель Fenix ADSV 10", brand="fenix", series="ADSV 10", kind="cable", linear=10,
         category="nahrivalnyi-kabel", tags=["pid-plytku", "tonkyi-kabel", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Універсальний нагрівальний двожильний кабель Fenix ADSV 18", images=['549e33637c'], brand="fenix", series="ADSV 18", kind="cable", linear=18,
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "pid-plytku", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"одножильний ASL1P 18", images=['549e33637c'], brand="fenix", series="ASL1P", kind="cable", linear=18,
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "odnozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Алюмінієві мати Fenix AL MAT 140", brand="fenix", series="AL MAT", kind="alu", density=140,
         category="pid-laminat", tags=["pid-laminat", "aliuminiievyi-mat"]),
    dict(title=r"кабель двожильний ADPSV 30", images=['3c89d9bbf8'], brand="fenix", series="ADPSV 30", kind="cable", linear=30,
         category="antyobledeninnia", tags=["vodostoky-ta-pokrivlia", "vidkryti-maidanchyky", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"вбудованим термостатом PFP 12", images=['3c89d9bbf8'], brand="fenix", series="PFP 12", kind="pipe", linear=12,
         category="antyobledeninnia", tags=["truby", "z-vbudovanym-termostatom"]),
    dict(title=r"вбудованим термостатом PFP 30", images=['3c89d9bbf8'], brand="fenix", series="PFP 30", kind="pipe", linear=30,
         category="antyobledeninnia", tags=["truby", "vodostoky-ta-pokrivlia", "z-vbudovanym-termostatom"]),
    # IN-THERM
    dict(title=r"кабель IN-THERM ADSV 20", brand="in-therm", series="ADSV 20", kind="cable", linear=20, country="chekhiia",
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "pid-plytku", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    dict(title=r"Нагрівальний мат двожильний IN-THERM 200", brand="in-therm", series="Mat 200", kind="mat", density=200, country="chekhiia",
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "ftoroplastova-izoliatsiia"]),
    # IN-THERM COMFORT
    dict(title=r"IN-THERM COMFORT PDSV 20", images=['dd72540f55'], brand="in-therm", series="COMFORT PDSV 20", kind="cable", linear=20, country="chekhiia",
         category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi"]),
    dict(title=r"Нагрівальний мат двожильний IN-THERM COMFORT 160", images=["d5200043fe"], brand="in-therm", series="COMFORT Mat 160", kind="mat", density=160, country="chekhiia",
         category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi"]),
    # АЛЮМАТИ
    dict(title=r"Алюмінієві мати IN-THERM AFMAT 150", brand="in-therm", series="AFMAT", kind="alu", density=150, country="kytai",
         category="pid-laminat", tags=["pid-laminat", "aliuminiievyi-mat"]),
    dict(title=r"Алюмінієві мати Fenix \(Чехія\)", images=['67bf8cbd69', 'f8592b19fa'], brand="fenix", series="AL MAT", kind="alu", density=140,
         category="pid-laminat", tags=["pid-laminat", "aliuminiievyi-mat"]),
]

HEADER_STOP = ("Средня", "альтернатив", "Hemstedt DI SI", "Гарантія поширю", "Відповідність")


def _header_roles(row) -> dict:
    roles = {}
    for i, v in enumerate(row):
        t = text(v)
        if not t:
            continue
        if any(s in t for s in HEADER_STOP):
            break
        if t.startswith("Потужність") and "power" not in roles:
            roles["power"] = i
        elif t.startswith("Довжина") and "length" not in roles:
            roles["length"] = i
        elif re.match(r"^(Площа|Пл\. укладки|H=)", t) and re.search(r"h\s*=|H=", t):
            roles.setdefault("area_at", []).append((i, t))
        elif t.startswith("Площа") and "area" not in roles:
            roles["area"] = i
        elif re.match(r"^(Сопротивление|Опір)", t):
            roles["resistance"] = i
        elif re.match(r"^Ціна акційного комплекту", t):
            roles["promo_kit"] = i
        elif re.match(r"^Акційна ціна", t):
            roles["promo"] = i
        elif re.match(r"^Ціна (комплект|за комплект)", t):
            roles["kit"] = i
        elif re.match(r"^Ціна", t) and "price" not in roles:
            roles["price"] = i
        elif re.match(r"^(Монтажна стрічка|Стрічка)", t):
            roles["tape"] = i
    return roles


NOTE_PATTERNS = [
    (r"Потужність кабелю погонна\s*(?:близько\s*)?([\d.,]+)\s*Вт/м", "power_w_m"),
    (r"Потужність (?:мату|питома)\s*([\d.,]+)\s*Вт/м кв", "power_w_m2"),
    (r"(?:Кабель|Провід|Кабеь) живлення\s*([^\n]+)", "cold_lead_m"),
    (r"Діаметр (?:нагрівального )?кабелю\s*(?:близько\s*)?([\d.,]+)\s*мм", "cable_diameter_mm"),
    (r"(Довічна гарантія|(?<=Гарантія )\d+\s*рок\w+)", "warranty"),
    (r"Зовнішня ізоляція\s*([^\n]+)", "outer_insulation"),
    (r"Внутрішня ізоляція\s*([^\n]+)", "inner_insulation"),
    (r"З'єднання нагрівального та живильного проводів\s*([^\n]+)", "connection"),
    (r"Крок укладання кабелю(?: на сітці)?\s*([\d.,]+)\s*м", "laying_step_m"),
    (r"Ширина мату\s*([\d.,]+)\s*м", "mat_width_m"),
    (r"Клас механічної міцності\s*(\w+)", "certification"),
]


def _notes_to_specs(notes: list[str]) -> tuple[list[dict], list[str]]:
    specs, rest = [], []
    for n in notes:
        matched = False
        for pat, slug in NOTE_PATTERNS:
            m = re.search(pat, n)
            if m:
                val = m.group(1).strip().rstrip(".")
                number = num(val) if S[slug][1] else None
                if slug == "cold_lead_m":
                    number = num(val)
                specs.append(sp(slug, val if S[slug][1] is None or number is None else number))
                matched = True
                break
        if not matched:
            rest.append(n)
    return specs, rest


def _parse_it_blocks(W: Writer, ws, g: list[list]):
    n = len(g)
    r = 0
    while r < n:
        row = g[r]
        block = None
        title = ""
        for v in row[:5]:
            t = text(v)
            if not t or not re.match(r"^(Нагрівальн|Тонкий|Універсальн|Ультратонк|Алюмініє)", t):
                continue
            for b in IT_BLOCKS:
                if re.search(b["title"], t):
                    block, title = b, t
                    break
            if block:
                break
        if not block:
            r += 1
            continue
        # заголовок таблиці
        h = r + 1
        while h < min(r + 12, n) and not any(re.match(r"^(Потужність|Довжина)", text(v)) for v in g[h][:6]):
            h += 1
        if h >= min(r + 12, n):
            W.warn(f"{ws.title}: не знайдено заголовок таблиці для «{title[:60]}»")
            r += 1
            continue
        intro = [text(v) for rr in range(r + 1, h) for v in g[rr][:5] if text(v) and re.match(r"^\d+\.", text(v))]
        roles = _header_roles(g[h])
        first = roles.get("power", roles.get("length"))
        d = h + 1
        if d < n and all(len(text(v)) <= 8 for v in g[d] if text(v)):
            # рядок одиниць: якщо ролі цін не знайдено — беремо колонки «грн»
            if "price" not in roles:
                grn = [i for i, v in enumerate(g[d]) if text(v) == "грн"]
                if grn:
                    roles["price"] = grn[0]
                    if len(grn) > 1:
                        roles["kit"] = grn[1]
            d += 1
        notes_from = max([i for k, i in roles.items() if isinstance(i, int)] + [i for i, _ in roles.get("area_at", [])]) + 1
        notes = []
        rows = []
        while d < n:
            row = g[d]
            pv = cell(row, first)
            if first is None or num(pv) is None or (isinstance(pv, str) and len(text(pv)) > 12):
                break
            rows.append(row)
            for v in row[notes_from:]:
                t = text(v)
                if t and t not in notes and not re.match(r"^\d+(\.\d+)?$", t):
                    notes.append(t)
            d += 1
        block_specs, rest_notes = _notes_to_specs(notes)
        rest_notes = [x for x in rest_notes if not re.match(r"^(Нові ціни|Спеціальна позиція|дешевше|Рекомендуємо|Практично|У довгостроков|\d\.)", x)]
        # Фото серії: стоїть праворуч від таблиці (стовпці приміток) у межах блоку, інакше — запасне з реєстру
        block_images = MEDIA.in_rows(W.file, ws.title, r + 1, d, min_col=notes_from) or MEDIA.by_hash(*block.get("images", []))
        for row in rows:
            _emit_it_row(W, ws, block, roles, row, block_specs, intro, rest_notes, block_images)
        r = d


def _emit_it_row(W, ws, b, roles, row, block_specs, intro, rest_notes, images):
    bn = BRAND_NAMES[b["brand"]]
    power = num(cell(row, roles.get("power"))) if "power" in roles else None
    length = num(cell(row, roles.get("length"))) if "length" in roles else None
    area = num(cell(row, roles.get("area"))) if "area" in roles else None
    price = cell(row, roles.get("price")) if "price" in roles else None
    kit = cell(row, roles.get("kit")) if "kit" in roles else None
    promo = money(cell(row, roles.get("promo"))) if "promo" in roles else None
    promo_kit = money(cell(row, roles.get("promo_kit"))) if "promo_kit" in roles else None
    note = None
    tags = list(b["tags"])
    if promo:
        note = f"Акційна ціна; звичайна ціна {money(price)} грн"
        price, kit = promo, promo_kit or kit
        tags.append("aktsiia")
    star = "*" in text(cell(row, roles.get("power", roles.get("length"))))
    if star:
        note = (note + ". " if note else "") + "Рекомендовано використовувати з термостатами Eberle (навантаження понад 16 А)"
    specs = []
    if power is not None:
        specs.append(sp("power_w", power))
    if b["kind"] in ("mat", "alu"):
        specs.append(sp("power_w_m2", float(b["density"])))
        tags.append(power_tag_m2(b["density"]))
        if area is not None:
            specs.append(sp("area_m2", area))
        if length is not None:
            specs.append(sp("length_m", length))
    else:
        specs.append(sp("power_w_m", float(b["linear"])))
        tags.append(power_tag_m(b["linear"]))
        if length is not None:
            specs.append(sp("length_m", length))
        for i, label in roles.get("area_at", []):
            a = num(cell(row, i))
            m = re.search(r"([\d.,]+)\s*Вт/м", label)
            step = re.search(r"[hH]\s*=\s*([\d.,]+)", label)
            if a is not None and m:
                specs.append(spec(f"area_at_{fmt(num(m.group(1))).replace(',', '-')}", f"Площа при {fmt(num(m.group(1)))} Вт/м² (крок {step.group(1) if step else '?'} м)", round(a, 2), round(a, 2), "м²"))
        if area is not None:
            specs.append(sp("area_m2", area))
    if "resistance" in roles and num(cell(row, roles["resistance"])) is not None:
        specs.append(sp("resistance_ohm", round(num(cell(row, roles["resistance"])), 1)))
    if "tape" in roles and num(cell(row, roles["tape"])) is not None:
        specs.append(sp("tape_m", num(cell(row, roles["tape"]))))
    specs.append(sp("cores", "одножильний" if "odnozhylnyi" in tags else "двожильний"))
    specs.append(sp("voltage_v", "230", 230.0))
    specs += block_specs
    if b.get("country"):
        tags.append(b["country"])
    pw = fmt(power)
    series = re.sub(r"\s+\d+(?:[.,]\d+)?$", "", b["series"])  # «ADSV 30» → «ADSV», щоб не дублювати потужність у назві
    if b["kind"] == "mat":
        name = f"Нагрівальний мат {bn} {series} {b['density']} Вт/м² — {fmt(area)} м², {pw} Вт"
        sku = f"{b['series']} {fmt(area).replace(',', '.')}m2"
    elif b["kind"] == "alu":
        name = f"Алюмінієвий мат {bn} {series} {b['density']} Вт/м² — {fmt(area)} м², {pw} Вт"
        sku = f"{b['series']} {fmt(area).replace(',', '.')}m2"
    elif b["kind"] == "pipe":
        name = f"Кабель для обігріву труб {bn} {series} {fmt(b['linear'])} Вт/м з термостатом — {fmt(length)} м, {pw} Вт"
        sku = f"{b['series']} {fmt(length).replace(',', '.')}m"
    else:
        name = f"Нагрівальний кабель {bn} {series} {fmt(b['linear'])} Вт/м — {fmt(length)} м, {pw} Вт"
        sku = f"{b['series']} {pw.replace(',', '.')}W"
    description = (bullets_html(intro) or "") + (desc_html(rest_notes) or "")
    W.add(sku=sku, name=name, brand=b["brand"], category=b["category"], tags=tags, price=price, kit=kit, price_note=note,
          specs=specs, sheet=ws.title, description=description or None, images=images)


def _parse_columnar(W: Writer, ws, g: list[list], r0: int, r1: int, *, category_for, extra_tags=None, image_rows=()):
    """Таблиці термостатів: рядки = характеристики, стовпці = моделі. r0/r1 — 1-based рядки включно."""
    rows = [g[i - 1] if i - 1 < len(g) else [] for i in range(r0, r1 + 1)]
    width = max(len(r) for r in rows)
    label_cols = sorted({c for r in rows for c in range(len(r)) if text(cell(r, c)) in ("модель", "торгова марка")})
    for c in range(width):
        if c in label_cols:
            continue
        L = max([lc for lc in label_cols if lc < c], default=None)
        if L is None:
            continue
        attrs, colors = {}, []
        for r in rows:
            lab = text(cell(r, L))
            val = cell(r, c)
            if val is None or text(val) == "":
                continue
            if lab:
                attrs[lab.rstrip(":")] = val
            elif re.search(r"біл|чорн|біжев|золот|срібл|сір|графіт|глянець", text(val).lower()) and len(text(val)) < 40:
                colors.append(text(val))
        model = text(attrs.get("модель"))
        if not model or model == "модель":
            continue
        col_images = [f for ir in image_rows for f in MEDIA.at(W.file, ws.title, ir, c)]
        brand_name = text(attrs.get("торгова марка")) or "IN-THERM"
        brand = {"in-therm": "in-therm", "eberle": "eberle", "fenix": "fenix"}.get(brand_name.lower(), "in-therm")
        variants = [(model, attrs.get("ціна, грн"), False)]
        wm = text(attrs.get("модель з WI-FI"))
        if wm and not wm.startswith("не програм"):
            variants.append((wm, attrs.get("ціна з WI-FI, грн"), True))
        for mdl, price, wifi in variants:
            if money(price) is None:
                continue
            typ = text(attrs.get("тип"))
            specs = [
                sp("type", typ + (" з Wi-Fi" if wifi and "wi-fi" not in typ.lower() else "")) if typ else None,
                sp("display", text(attrs.get("дисплей"))) if attrs.get("дисплей") else None,
                sp("adaptive", text(attrs.get("адаптивна функція"))) if attrs.get("адаптивна функція") else None,
                sp("country", text(attrs.get("країна виробництва") or attrs.get("країна"))) if (attrs.get("країна виробництва") or attrs.get("країна")) else None,
                sp("sensor_air", text(attrs.get("датчик повітря"))) if attrs.get("датчик повітря") else None,
                sp("sensor_floor", text(attrs.get("датчик підлоги"))) if attrs.get("датчик підлоги") else None,
                sp("temp_range", text(attrs.get("діапазон температур, °C") or attrs.get("темп. діапазон"))) if (attrs.get("діапазон температур, °C") or attrs.get("темп. діапазон")) else None,
                sp("max_load_a", text(attrs.get("навантаження, А")), num(attrs.get("навантаження, А"))) if attrs.get("навантаження, А") else None,
                sp("ip", text(attrs.get("ступінь захисту"))) if attrs.get("ступінь захисту") else None,
                sp("mounting", text(attrs.get("спосіб монтажу"))) if attrs.get("спосіб монтажу") else None,
                sp("compat", text(attrs.get("сумісність"))) if attrs.get("сумісність") else None,
                sp("warranty", text(attrs.get("гарантія, років") or attrs.get("гарантія"))) if (attrs.get("гарантія, років") or attrs.get("гарантія")) else None,
                sp("zones", text(attrs.get("кількість зон"))) if attrs.get("кількість зон") else None,
                sp("purpose", text(attrs.get("призначення"))) if attrs.get("призначення") else None,
                sp("protocol", text(attrs.get("протокол"))) if attrs.get("протокол") else None,
                sp("power_supply", text(attrs.get("тип живлення"))) if attrs.get("тип живлення") else None,
                sp("color", ", ".join(colors)) if colors else None,
            ]
            descr = text(attrs.get("опис"))
            place = text(attrs.get("тип монтажу"))
            tags = _thermostat_tags(typ, text(attrs.get("дисплей")), text(attrs.get("протокол")), text(attrs.get("спосіб монтажу")), "wi-fi" if wifi else "")
            if text(attrs.get("датчик підлоги")).lower().startswith("так"):
                tags.append("datchyk-pidlohy")
            if text(attrs.get("датчик повітря")).lower().startswith("так"):
                tags.append("datchyk-povitria")
            ct = country_tag(attrs.get("країна виробництва") or attrs.get("країна"))
            if ct:
                tags.append(ct)
            tags += extra_tags or []
            cat, kind_name = category_for(attrs, descr, place)
            if cat == "antyobledeninnia" and "din-reika" in tags:
                tags.append("dlia-snihotanennia")
            name = f"{kind_name} {BRAND_NAMES[brand]} {mdl}"
            if descr:
                name += f" — {descr}"
            extra = text(attrs.get("Додаткова інформація") or attrs.get("додаткові комплектуючи"))
            W.add(sku=mdl, name=name, brand=brand, category=cat, tags=tags, price=price, specs=specs, sheet=ws.title, images=col_images,
                  short=typ.capitalize() + ("; " + text(attrs.get("дисплей")) + " дисплей" if attrs.get("дисплей") else "") if typ else None,
                  description=desc_html([extra, text(attrs.get("перехідники до радіаторів")) and "Перехідники до радіаторів: " + text(attrs.get("перехідники до радіаторів"))]))


def _parse_it_thermostats(W: Writer, ws):
    g = grid(ws)
    assert text(g[3][0]) == "модель" and text(g[4][0]).startswith("ціна"), "ТЕРМОСТАТИ: змінилась розмітка таблиці 1"
    assert text(g[33][0]) == "модель" and text(g[45][0]).startswith("ціна"), "ТЕРМОСТАТИ: змінилась розмітка таблиці 2"
    assert text(g[52][0]) == "модель" and text(g[60][0]).startswith("ціна"), "ТЕРМОСТАТИ: змінилась розмітка таблиці 3"
    _parse_columnar(W, ws, g, 3, 30, category_for=lambda a, d, p: ("termorehuliatory", "Терморегулятор"), image_rows=(1, 2))

    def cat2(attrs, descr, place):
        t = text(attrs.get("тип")).lower()
        if "zigbee" in text(attrs.get("протокол")).lower() or "радіатор" in t:
            return "termorehuliatory", "Термоголовка для радіатора"
        if text(attrs.get("навантаження, А")) == "3 А":
            return "termorehuliatory", "Терморегулятор для газового котла"
        return "termorehuliatory", "Терморегулятор"

    _parse_columnar(W, ws, g, 32, 49, category_for=cat2, image_rows=(30, 31))

    def cat3(attrs, descr, place):
        if descr:
            return "antyobledeninnia", "Датчик"
        if "метео" in text(attrs.get("тип")).lower():
            return "antyobledeninnia", "Метеостанція (контролер сніготанення)"
        return "antyobledeninnia", "Терморегулятор для зовнішнього обігріву"

    _parse_columnar(W, ws, g, 51, 62, category_for=cat3, image_rows=(49, 50))


def _parse_it_film(W: Writer, ws):
    g = grid(ws)
    types = []
    for c in range(1, 5):
        title = text(g[0][c])
        m = re.search(r"IN-THERM\s+(T|Т|MH)\s*(\d+)?", title)
        code = {"Т": "T"}.get(m.group(1), m.group(1)) if m else f"F{c}"
        density = num(re.search(r"(\d+)\s*Вт", text(g[3][c])).group(1)) if re.search(r"(\d+)\s*Вт", text(g[3][c])) else None
        types.append(dict(col=c, title=title, code=code, density=density, models=text(g[2][c]), lines=[text(g[r][c]) for r in range(3, 9)]))
    for r in range(9, 12):
        width = num(g[r][0])
        if width is None:
            continue
        for t in types:
            price = money(g[r][t["col"]])
            if not price:
                continue
            selfreg = t["code"] == "MH"
            name = f"{'Саморегулююча і' if selfreg else 'І'}нфрачервона нагрівальна плівка IN-THERM {t['code']}{'' if selfreg else ' ' + fmt(t['density'])} — {fmt(t['density'])} Вт/м², ширина {int(width)} см"
            W.add(sku=f"{t['code']}{'' if selfreg else int(t['density'])}-{int(width)}", name=name, brand="in-therm",
                  category="pid-laminat", tags=["pid-laminat", "plivka", power_tag_m2(t["density"]), "koreia"], price=price, unit="м²",
                  specs=[sp("power_w_m2", t["density"]), sp("roll_width_m", width / 100), sp("model", t["models"]), sp("thickness_mm", 0.34),
                         sp("country", "Корея")],
                  images=MEDIA.at(W.file, ws.title, 2, t["col"]),
                  short="Ціна за 1 м². Крок нарізання 0,25 м, у рулоні 100 м. Монтаж під ламінат на підкладку.",
                  description=desc_html([text(g[1][5])] + t["lines"]), sheet=ws.title)


def _parse_it_selfreg(W: Writer, ws):
    g = grid(ws)
    brand, extra, country = None, "", None
    for rn, row in enumerate(g, 1):
        t1 = text(cell(row, 1))
        if t1.startswith("Саморегульований кабель ELTRACE"):
            brand, extra, country = "eltrace", "", "frantsiia"
            continue
        if t1.startswith("Саморегульований кабель IN-THERM EXTRA"):
            brand, extra, country = "in-therm", " EXTRA", "kytai"
            continue
        if t1.startswith("Саморегульований кабель IN-THERM"):
            brand, extra, country = "in-therm", "", "kytai"
            continue
        m = re.match(r"^(TRACECO|SRL\d+-2CR)\s*(\d+)\s*W", t1)
        if m and brand and money(cell(row, 4)):
            w = float(m.group(2))
            sku = f"TRACECO {int(w)}W" if m.group(1) == "TRACECO" else f"SRL{int(w)}-2CR{extra}"
            W.add(row=rn, sku=sku, name=f"Саморегулюючий кабель {BRAND_NAMES[brand]} {sku.replace(' EXTRA', ' Extra')} — {int(w)} Вт/м",
                  brand=brand, category="samorehuliuiuchyi-kabel", tags=["truby", "vodostoky-ta-pokrivlia", "vidriznyi", country],
                  price=cell(row, 4), unit="м",
                  specs=[sp("power_w_m", w), sp("max_length_m", num(cell(row, 2))), sp("dimensions", text(cell(row, 3)) + " мм"),
                         sp("warranty", "5 років"), sp("certification", "M2")],
                  short="Ціна за погонний метр. Комплект муфт з 2 м проводів живлення — окремо.", sheet=ws.title)
            continue
        t2 = text(cell(row, 2))
        if re.match(r"^(Скоба|Розпірна скоба|Алюмінієве кріплення|Мідне кріплення|Мідний фіксатор|Алюмінієвий фіксатор)", t2):
            price = num(cell(row, 4))
            if price is None:
                continue
            per_m = "грн/м" in text(cell(row, 4))
            W.add(row=rn, sku=re.sub(r"\s*\(.*$", "", t2), name=re.sub(r"\s*\(.*$", "", t2) + " Fenix", brand="fenix", category="antyobledeninnia",
                  tags=["vodostoky-ta-pokrivlia"], price=price, unit="м" if per_m else "шт",
                  price_note="під замовлення" if "замовлення" in text(cell(row, 4)) else ("ціна за упаковку" if not per_m else None),
                  specs=[sp("step", text(cell(row, 3)))], short=re.search(r"\((.*)\)", t2).group(1) if "(" in t2 else None, sheet=ws.title)


def _parse_it_energy(W: Writer, ws, kind_by_title):
    """Таблиці «Бренд | Модель | Зображення | Специфікація | …» (інвертори, АКБ, зарядні станції)."""
    g = grid(ws)
    title, header = "", None
    seen = set()
    for rn, row in enumerate(g, 1):
        t1 = text(cell(row, 1))
        if t1 == "Бренд" and text(cell(row, 2)).startswith("Модель"):
            header = {text(v): i for i, v in enumerate(row) if text(v)}
            continue
        if header is None or not t1:
            if t1 and any(k in t1 for k in kind_by_title):
                title = t1
            continue
        if any(k in t1 for k in kind_by_title):
            title, header = t1, None
            continue
        if t1.startswith(("Важлив", "Матеріал", "ВАЖЛИВО", "http", "Не ", "Моніторте", "1.", "2.", "3.", "4.", "5.", "6.", "7.")):
            continue
        model = text(cell(row, 2))
        if not model:
            continue
        model = re.sub(r"^(Deye|BLUETTI|Allpowers)\s+", "", model, flags=re.I)
        brand_raw = re.sub(r"\s+з індикатором.*$", "", t1).split("/")[-1].strip()
        brand = slugify(brand_raw)
        if brand not in BRAND_COUNTRY:
            W.warn(f"{ws.title}: невідомий бренд {brand_raw!r} ({model}) — пропущено")
            continue
        if (brand, model) in seen:
            continue
        seen.add((brand, model))
        kind = next((v for k, v in kind_by_title.items() if k in title), "Обладнання")
        specs = []
        for label, i in header.items():
            v = cell(row, i)
            if v is None or text(v) == "" or label in ("Бренд", "Зображення", "Специфікація") or label.startswith("Модель"):
                continue
            slug = {
                "Номінальна потужність, W": "power_w", "Пікова потужність, W": "peak_power_w", "Вага, кг": "weight_kg",
                "Розміри, см": "dimensions", "Тип акумулятору": "battery_type", "Напруга, В": "voltage_v", "Ємність, Ah": "capacity_ah",
                "Потужність, W": "power_w", "Ємність, W/h": "capacity_wh",
            }.get(label)
            if slug:
                specs.append(sp(slug, num(v) if S[slug][1] and num(v) is not None else text(v)))
            elif not label.startswith("Роздрібна ціна"):
                specs.append(spec(slugify(label)[:40], label, text(v)))
        spec_text = text(cell(row, header.get("Специфікація", 4)))
        if "Однофазний" in spec_text:
            specs.append(sp("phases", "однофазний"))
        elif "Трифазний" in spec_text:
            specs.append(sp("phases", "трифазний"))
        price = cell(row, header["Роздрібна ціна, грн"]) if "Роздрібна ціна, грн" in header else None
        warranty = re.search(r"Гарантія\s*([^.]+)", title)
        if warranty:
            specs.append(sp("warranty", warranty.group(1).strip()))
        name = f"{kind} {BRAND_NAMES[brand]} {model}"
        m = re.search(r"Номінальна (?:потужність|ємність) - ?([\d.,]+ ?(?:кВт|Аh|Ah))", spec_text)
        if m:
            name += f" ({m.group(1)})"
        W.add(row=rn, sku=f"{BRAND_NAMES[brand]} {model}", name=name, brand=brand, category="enerhetyka", tags=[BRAND_COUNTRY.get(brand)] if BRAND_COUNTRY.get(brand) else [],
              price=price, price_note=None if price else "ціну уточнюйте", specs=specs, sheet=ws.title,
              description=desc_html(spec_text.split("\n")))


def parse_in_therm():
    W = Writer("in-therm", "ТОВ «ІН-ТЕРМ» (прайс 13.08.2026)", "2026-08-13-in-therm.xlsx", "2026-08-13")
    wb = load_xlsx(W.file)
    for sn in ("HEMSTEDT", "HEMSTEDT DI SI", "FENIX ULTRA", "FENIX", "IN-THERM", "IN-THERM COMFORT", "АЛЮМАТИ"):
        ws = wb[sn]
        _parse_it_blocks(W, ws, grid(ws))
    _parse_it_thermostats(W, wb["ТЕРМОСТАТИ"])
    _parse_it_film(W, wb["ПЛІВКОВА ПІДЛОГА"])
    _parse_it_selfreg(W, wb["САМРЕГ+КОМПЛ"])
    _parse_it_energy(W, wb["ІНВ+ПАНЕЛІ+АККУ"], {"Інвертори": "Гібридний інвертор", "Акумулятори, Модуль": "Акумуляторна батарея", "Акумулятори LiFePO4": "Акумулятор LiFePO4"})
    _parse_it_energy(W, wb["ЗАРЯДНІ СТАНЦІЇ"], {"Зарядні станції": "Зарядна станція"})

    ws = wb["НАГРІВАЛЬНІ КИЛИМКИ"]
    g = grid(ws)
    for c in range(1, 4):
        name, price, descr = text(g[3][c]), money(g[5][c]), text(g[4][c])
        if name and price:
            W.add(sku=name, name=f"Нагрівальний килимок {name}", brand="in-therm", category="kylymky-z-pidihrivom", tags=["dlia-domu"],
                  price=price, specs=[sp("warranty", "12 місяців")], description=desc_html(descr.split("\n")), sheet=ws.title,
                  images=MEDIA.at(W.file, ws.title, 7, c) + MEDIA.at(W.file, ws.title, 8, c))

    ws = wb["ЗВП"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        mark, descr, price = text(cell(row, 1)), text(cell(row, 2)), cell(row, 3)
        if not mark or money(price) is None:
            continue
        is_kit = mark.startswith("W")
        name = f"Захист від протікання IN-THERM {mark}" + (" (готовий комплект)" if is_kit else "")
        W.add(row=rn, sku=f"ZVP {mark}", name=name, brand="in-therm", category="zakhyst-vid-protikannia", tags=["dlia-domu", "kytai"], price=price,
              short=text(cell(row, 4)) or None, description=desc_html([descr]), sheet=ws.title)

    ws = wb["ІЧ ПАНЕЛІ FENIX"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t = text(cell(row, 1))
        if t.startswith("ECOSUN") and money(cell(row, 7)):
            W.add(row=rn, sku=t, name=f"Інфрачервона панель Fenix {t} — {fmt(num(cell(row, 2)))} Вт", brand="fenix", category="infrachervoni-obihrivachi",
                  tags=[], price=cell(row, 7),
                  specs=[sp("power_w", num(cell(row, 2))), sp("voltage_v", text(cell(row, 3))), sp("weight_kg", num(cell(row, 4))),
                         sp("dimensions", text(cell(row, 6)) + " мм"), sp("ip", "IP 44"), sp("color", "білий")],
                  short="Високотемпературна стельова панель для приміщень з висотою стелі 3,5–8 м, локального обігріву та вулиці.", sheet=ws.title)
        elif t.startswith("Крепление") and money(cell(row, 7)):
            W.add(row=rn, sku="ECOSUN S+ bracket", name="Кріплення Fenix для панелей ECOSUN S+ зі зміною кута нахилу", brand="fenix",
                  category="infrachervoni-obihrivachi", tags=[], price=cell(row, 7), sheet=ws.title)
    W.flush()


# ---------------------------------------------------------------------------
# 4. SMART — терморегулятори
# ---------------------------------------------------------------------------


def parse_smart():
    W = Writer("smart", "SMART (прайс 2026)", "2026-smart-thermostats.xlsx", "2026-01-01")
    wb = load_xlsx(W.file)
    ws = wb["Prices"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        model = text(cell(row, 0))
        if not model or money(cell(row, 1)) is None or model == "Модель":
            continue
        tags = ["mekhanichnyi"] if model.startswith("RTC") else ["tsyfrovyi"]
        if "WT" in model or "PRO+" in model:
            tags.append("wi-fi")
        W.add(row=rn, sku=model, name=f"Терморегулятор {model}", brand="smart", category="termorehuliatory", tags=tags, price=cell(row, 1),
              specs=[sp("max_load_a", "16", 16.0)], sheet=ws.title)
    W.flush()


# ---------------------------------------------------------------------------
# 5. «РД» — Nexans, Wärme, Profitherm, OJ Electronics, Zuver, Акваблок
# ---------------------------------------------------------------------------


def parse_rd():
    W = Writer("rd", "Прайс РД (Nexans / Wärme / Profitherm), 15.09.2026", "2026-09-15-rd-nexans-profitherm.xlsx", "2026-09-15")
    wb = load_xlsx(W.file)

    def code_spec(v):
        return spec("supplier_code", "Код постачальника", text(v)) if text(v) else None

    # --- Nexans
    ws = wb[" Nexans"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t = text(cell(row, 1))
        if t.startswith("TXLP/2R"):
            length, power = num(cell(row, 3)), num(cell(row, 2))
            W.add(row=rn, sku=t, name=_cable_name("Nexans", "", t, length, power, 17).replace("  ", " "), brand="nexans", category="nahrivalnyi-kabel",
                  tags=["u-stiazhku", "dvozhylnyi", "17-vt-m"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("length_m", length), sp("power_w_m", 17.0), sp("resistance_ohm", num(cell(row, 5))),
                         sp("area_range_m2", text(cell(row, 6))), sp("tape_m", num(cell(row, 4))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Секція двожильного екранованого кабелю Nexans TXLP/2R 17 Вт/м для укладання в стяжку.", sheet=ws.title)
        elif t.startswith("MILLIMAT"):
            sku = re.sub(r"\s+", " ", t).replace("m 2", "m²")
            area, power = num(cell(row, 6)), num(cell(row, 2))
            W.add(row=rn, sku=sku, name=_mat_name("Nexans", "", sku, area, power, 150).replace("  ", " "), brand="nexans", category="nahrivalni-maty",
                  tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("area_m2", area), sp("size_m", text(cell(row, 3))), sp("power_w_m2", 150.0),
                         sp("resistance_ohm", num(cell(row, 5))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Нагрівальний мат Nexans Millimat/150 на основі двожильного екранованого кабелю для плиткового клею.", sheet=ws.title)
        elif t.startswith("RED DEFROST SNOW"):
            sku = t.rstrip(")")
            length, power = num(cell(row, 3)), num(cell(row, 2))
            W.add(row=rn, sku=sku, name=f"Секція для сніготанення Nexans {sku} — {fmt(length)} м, {fmt(power)} Вт (28 Вт/м)", brand="nexans",
                  category="antyobledeninnia", tags=["vidkryti-maidanchyky", "vodostoky-ta-pokrivlia", "dvozhylnyi", "28-vt-m"], price=cell(row, 7),
                  specs=[sp("power_w", power), sp("length_m", length), sp("power_w_m", 28.0), sp("resistance_ohm", num(cell(row, 5))), code_spec(cell(row, 6))],
                  short="Двожильний екранований кабель Nexans DEFROST SNOW для систем антиобледеніння відкритих площ і водостоків.", sheet=ws.title)

    # --- Wärme
    ws = wb["Wärme"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t = text(cell(row, 1))
        if t.startswith("Комплект Wärme Twin flex cable"):
            sku = t.replace("Комплект ", "")
            length = num(cell(row, 2))
            power = num(re.search(r"(\d+)\s*W", t).group(1))
            W.add(row=rn, sku=sku, name=f"Нагрівальний кабель {sku} — {fmt(length)} м, {fmt(power)} Вт (15 Вт/м)", brand="warme", category="nahrivalnyi-kabel",
                  tags=["pid-plytku", "u-stiazhku", "dvozhylnyi", "tonkyi-kabel", "15-vt-m"], price=cell(row, 6), kit=cell(row, 8),
                  specs=[sp("power_w", power), sp("length_m", length), sp("area_range_m2", text(cell(row, 3))), sp("resistance_ohm", num(cell(row, 4))),
                         sp("tape_m", num(cell(row, 5))), sp("cores", "двожильний"), code_spec(cell(row, 7))],
                  short="Секція тонкого двожильного кабелю Wärme Twin flex 15 Вт/м. Ціна комплекту включає монтажну стрічку та гофру.", sheet=ws.title)
        elif t.startswith("Комплект Wärme Twin mat"):
            sku = t.replace("Комплект ", "")
            area = num(cell(row, 2))
            power = num(re.search(r"(\d+)\s*W", t).group(1))
            W.add(row=rn, sku=sku, name=_mat_name("Wärme", "", sku.replace("Wärme ", ""), area, power, 150).replace("  ", " "), brand="warme", category="nahrivalni-maty",
                  tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=cell(row, 5), kit=cell(row, 7),
                  specs=[sp("power_w", power), sp("area_m2", area), sp("size_m", text(cell(row, 3))), sp("power_w_m2", 150.0),
                         sp("resistance_ohm", num(cell(row, 4))), sp("cores", "двожильний"), code_spec(cell(row, 6))],
                  short="Нагрівальний мат Wärme Twin mat 150 Вт/м² на основі двожильного кабелю для плиткового клею.", sheet=ws.title)

    # --- Profitherm
    ws = wb["Profitherm"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t = text(cell(row, 1))
        if t.startswith("PROFI THERM 2"):
            sku = re.sub(r"\s+нагрівальна секція\s*$", "", t)
            sku = re.sub(r"\s+", " ", sku)
            length, power = num(cell(row, 3)), num(cell(row, 2))
            W.add(row=rn, sku=sku, name=_cable_name("Profi Therm", "", sku.replace("PROFI THERM", ""), length, power, 19).replace("  ", " "), brand="profitherm",
                  category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "19-vt-m"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("length_m", length), sp("power_w_m", 19.0), sp("resistance_ohm", num(cell(row, 4))),
                         sp("area_range_m2", text(cell(row, 5))), sp("tape_m", num(cell(row, 6))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Нагрівальна секція Profi Therm 2 на основі двожильного кабелю 19 Вт/м для укладання в стяжку.", sheet=ws.title)
        elif t.startswith("PROFI THERM 150"):
            sku = re.sub(r"\s+нагрівальній мат\s*$", "", t)
            area, power = num(cell(row, 5)), num(cell(row, 2))
            W.add(row=rn, sku=sku, name=_mat_name("Profi Therm", "", sku.replace("PROFI THERM", ""), area, power, 150).replace("  ", " "), brand="profitherm",
                  category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("area_m2", area), sp("size_m", text(cell(row, 3))), sp("power_w_m2", 150.0),
                         sp("resistance_ohm", num(cell(row, 4))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Нагрівальний мат Profi Therm 150 Вт/м² на основі двожильного кабелю для плиткового клею.", sheet=ws.title)

    ws = wb[" Profitherm Eko "]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t = re.sub(r"\s+", " ", text(cell(row, 1)))
        if t.startswith("PROFI THERM Eko -2"):
            length, power = num(cell(row, 3)), num(cell(row, 2))
            W.add(row=rn, sku=t, name=_cable_name("Profi Therm", "Eko", t.replace("PROFI THERM Eko -2", "").strip(), length, power, 16.5).replace("  ", " "),
                  brand="profitherm", category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "16-5-vt-m"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("length_m", length), sp("power_w_m", 16.5), sp("resistance_ohm", num(cell(row, 4))),
                         sp("area_range_m2", text(cell(row, 5))), sp("tape_m", num(cell(row, 6))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Двожильний нагрівальний кабель Profi Therm Eko 16,5 Вт/м — бюджетна серія для укладання в стяжку.", sheet=ws.title)
        elif t.startswith("PROFI THERM Eko mat"):
            area, power = num(cell(row, 3)), num(cell(row, 2))
            W.add(row=rn, sku=t, name=_mat_name("Profi Therm", "Eko", t.replace("PROFI THERM Eko mat", "").strip(), area, power, 150).replace("  ", " "),
                  brand="profitherm", category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=cell(row, 5), kit=cell(row, 7),
                  specs=[sp("power_w", power), sp("area_m2", area), sp("power_w_m2", 150.0), sp("resistance_ohm", num(cell(row, 4))),
                         sp("cores", "двожильний"), code_spec(cell(row, 6))],
                  short="Двожильний нагрівальний мат Profi Therm Eko — бюджетна серія для плиткового клею.", sheet=ws.title)
        elif re.match(r"^PROFI THERM [EЕ]ko Flex", t):
            sku = re.sub(r"\s*Вт\.?\s*$", " Вт", t).replace("Еко", "Eko")
            length, power = num(cell(row, 4)), num(cell(row, 2))
            W.add(row=rn, sku=sku, name=_cable_name("Profi Therm", "Eko Flex", "", length, power, 11).replace("  ", " ").replace(" —", " —"),
                  brand="profitherm", category="nahrivalnyi-kabel", tags=["pid-plytku", "tonkyi-kabel", "dvozhylnyi"], price=cell(row, 7), kit=cell(row, 9),
                  specs=[sp("power_w", power), sp("length_m", length), sp("area_range_m2", text(cell(row, 3))), sp("resistance_ohm", num(cell(row, 5))),
                         sp("tape_m", num(cell(row, 6))), sp("cores", "двожильний"), code_spec(cell(row, 8))],
                  short="Тонкий двожильний кабель Profi Therm Eko Flex для укладання в плитковий клей.", sheet=ws.title)

    # --- Термостати та датчики (Nexans, Wärme Technik, Profitherm, OJ Electronics)
    ws = wb["Термостати та датчики"]
    brand = None
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t1 = text(cell(row, 1))
        for key, b in (("Nexans", "nexans"), ("Wärme", "warme"), ("Profitherm", "profitherm"), ("Oj Electronics", "oj-electronics")):
            if t1.startswith("Терморегулятори " + key):
                brand = b
        price = cell(row, 5)
        if brand is None or money(price) is None:
            continue
        descr = text(cell(row, 2))
        raw3 = str(cell(row, 3) or "")
        name = re.split(r"\s{3,}|\n", raw3.strip())[0].strip() if raw3.strip() else descr.split(" - ")[0].split(" (")[0]
        name = re.sub(r"^Терморегулятор\s+", "", name)
        rest = re.sub(r"\s{2,}", " ", raw3.replace("\n", " ")).strip()
        rest = rest[len(name):].strip() if rest.startswith(name) else rest
        # «ETO2-4550 для систем …» → артикул ETO2-4550, решта — в короткий опис
        m_cut = re.match(r"^(.*?)\s+(для|містить|з датчиком|з 2)\s(.*)$", name)
        if m_cut:
            name, rest = m_cut.group(1), (m_cut.group(2) + " " + m_cut.group(3) + " " + rest).strip()
        name = re.sub(r"^Датчик\s+", "", name)
        low = (name + " " + descr).lower()
        is_sensor = low.startswith("датчик") or re.match(r"^(etf|etor|etog)", name.lower())
        outdoor = re.match(r"^(etr|eto|etor|etog|eti)", name.lower()) is not None
        if is_sensor:
            cat, kind = ("antyobledeninnia" if outdoor else "montazh-ta-aksesuary"), "Датчик"
            tags = ["vodostoky-ta-pokrivlia"] if outdoor else ["datchyk-pidlohy"]
        elif outdoor:
            cat, kind, tags = "antyobledeninnia", "Терморегулятор", ["din-reika", "dlia-snihotanennia" if not name.lower().startswith("eti") else "truby"]
        else:
            cat, kind, tags = "termorehuliatory", "Терморегулятор", _thermostat_tags(descr, rest, name)
            if re.match(r"^(etv|etn)", name.lower()):
                tags.append("din-reika")
            if "датчик" in (descr + rest).lower():
                tags.append("datchyk-pidlohy")
        bn_ = BRAND_NAMES[brand]
        has_brand = name.lower().startswith(bn_.lower()) or name.lower().startswith(("profitherm", "wärme"))
        W.add(row=rn, sku=name, name=f"{kind} {'' if has_brand else bn_ + ' '}{name}", brand=brand, category=cat, tags=tags, price=price,
              specs=[code_spec(cell(row, 4)), sp("max_load_a", "16", 16.0) if re.search(r"3[56]00\s*Вт", descr) else None],
              short=rest or None, description=desc_html([descr]), sheet=ws.title)

    # --- Саморегулюючий кабель
    ws = wb["Самрег"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t1 = text(cell(row, 1))
        price = cell(row, 4)
        if money(price) is None or not t1:
            continue
        descr = text(cell(row, 2))
        if t1.startswith("Комплект муфт"):
            W.add(row=rn, sku=t1, name=t1 + " Profi Therm", brand="profitherm", category="montazh-ta-aksesuary", tags=["truby"], price=price, sheet=ws.title)
            continue
        brand = "nexans" if "DEFROST" in t1 else "profitherm"
        on_order = "DEFROST" in t1 or re.search(r"PL\d+", t1) is not None
        w = re.search(r"(\d+)\s*Вт/м", descr) or re.search(r"(?:PRO|PL|PIPE)\s*(\d+)", t1) or re.search(r"(\d+)MSR", t1)
        sku = re.sub(r"^(Саморегулюючий кабель|Кабель для антикригових систем)\s*", "", t1)
        W.add(row=rn, sku=sku, name=f"Саморегулюючий кабель {sku}" + (f" — {w.group(1)} Вт/м" if w else ""), brand=brand,
              category="samorehuliuiuchyi-kabel", tags=["truby", "vidriznyi"] + (["pid-zamovlennia"] if on_order else []), price=price, unit="м",
              price_note="на замовлення, 100% передплата" if on_order else None,
              specs=[sp("power_w_m", float(w.group(1))) if w else None, code_spec(cell(row, 3)) if re.match(r"^[\dA-Z]+$", text(cell(row, 3))) else None],
              description=desc_html([descr]), sheet=ws.title)

    # --- Заземлення Zuver
    ws = wb["заземлення Zuver"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t1 = text(cell(row, 1))
        if t1 == "ZUVER 4.4":
            parts = [text(cell(row, i)) for i in range(3, 9) if text(cell(row, i))]
            W.add(row=rn, sku=t1, name=f"Комплект заземлення Zuver 4.4 для приватного будинку", brand="zuver", category="zazemlennia", tags=["dlia-domu"],
                  price=cell(row, 10), specs=[code_spec(cell(row, 9))], description=bullets_html(parts), short=text(cell(row, 2)), sheet=ws.title)
        elif t1 and money(cell(row, 9)) and t1 not in ("Найменування",):
            W.add(row=rn, sku=t1, name=f"{t1} Zuver", brand="zuver", category="zazemlennia", tags=[], price=cell(row, 9),
                  unit="м" if "м.п" in text(cell(row, 3)) and "бандаж" not in t1.lower() else "шт", short=text(cell(row, 3)), sheet=ws.title)

    # --- Акваблок
    ws = wb["Акваблок"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t1 = text(cell(row, 1))
        if t1.startswith(("Комплект Акваблок", "Датчик Акваблок")) and money(cell(row, 7)):
            W.add(row=rn, sku=t1, name=t1 + " — бездротова система захисту від протікання", brand="akvablok", category="zakhyst-vid-protikannia", tags=["dlia-domu"],
                  price=cell(row, 7),
                  specs=[sp("dimensions", text(cell(row, 3))) if text(cell(row, 3)) else None, spec("kit", "Комплектація", text(cell(row, 4))),
                         sp("power_supply", text(cell(row, 5))), code_spec(cell(row, 6))],
                  sheet=ws.title)

    # --- Комплектуючі
    ws = wb["комплек-щі"]
    for rn, row in enumerate(ws.iter_rows(values_only=True), 1):
        t0 = text(cell(row, 0))
        if t0 and money(cell(row, 3)) and t0 != "Матеріали для монтажу":
            unit = "м" if "м/п" in text(cell(row, 1)) else "шт"
            tags = ["vodostoky-ta-pokrivlia"] if re.search(r"жолоб|труб", t0.lower()) else []
            W.add(row=rn, sku=t0, name=t0, brand=None, category="montazh-ta-aksesuary", tags=tags, price=cell(row, 3), unit=unit,
                  specs=[code_spec(cell(row, 2))], price_note="продається лише разом з нагрівальним кабелем", sheet=ws.title)
    W.flush()


# ---------------------------------------------------------------------------
# 6. Easytherm / Extherm / Hot Fly
# ---------------------------------------------------------------------------


def parse_easytherm():
    W = Writer("easytherm-extherm", "Easytherm / Extherm / Hot Fly (прайс 01.04.2026)", "2026-04-01-easytherm-extherm-hotfly.xlsx", "2026-04-01")
    wb = load_xlsx(W.file)
    sheet_brand = {"Extherm": "extherm", "Easytherm": "easytherm", "Hot Fly": "hot-fly"}
    for ws in wb.worksheets:
        brand = next((b for k, b in sheet_brand.items() if k in ws.title), None)
        if not brand or "Килимки_Extherm" in ws.title:
            continue
        bn = BRAND_NAMES[brand]
        header, section, insulation, warranty = None, {}, None, None
        rows = grid(ws)
        for idx, row in enumerate(rows):
            rn = idx + 1
            vals = {i: text(v) for i, v in enumerate(row) if text(v)}
            if not vals:
                continue
            joined = " ".join(vals.values())
            if header is None or len(vals) <= 2:
                m_w = re.search(r"Гарантія\s*[–-]\s*(\d+\s*рок\w+)", joined)
                if m_w:
                    warranty = m_w.group(1)
                if re.match(r"^(МАТИ|КАБЕЛІ)", joined):
                    section = dict(
                        mat=joined.startswith("МАТИ"),
                        cores="одножильний" if "ОДНОЖИЛЬН" in joined else "двожильний",
                        density=num(re.search(r"(\d+)\s*Вт/м²", joined).group(1)) if re.search(r"(\d+)\s*Вт/м²", joined) else None,
                        linear=num(re.search(r"(\d+)\s*Вт/мп", joined).group(1)) if re.search(r"(\d+)\s*Вт/мп", joined) else None,
                        diam=num(re.search(r"d\s*=\s*([\d.,]+)\s*mm", joined).group(1)) if re.search(r"d\s*=\s*([\d.,]+)\s*mm", joined) else None,
                        outdoor="зовнішньої установки" in joined and "внутрішньої" not in joined,
                        thin="ТОНК" in joined,
                        foil="фольг" in ws.title.lower(),
                        text=joined,
                    )
                    nxt = " ".join(text(v) for v in rows[idx + 1] if text(v)) if idx + 1 < len(rows) else ""
                    insulation = nxt if "ізоляція" in nxt else None
                    continue
            if any(v.startswith("Референс") for v in vals.values()) or (any(v.startswith("Найменування") for v in vals.values()) and any(v.startswith("Роздріб") for v in vals.values())):
                header = {}
                for i, v in vals.items():
                    for key, pref in (("ref", "Референс"), ("name", "Найменування"), ("power", "Потужність"), ("area", "Площа"), ("length", "Довжина"),
                                      ("price", "Роздріб"), ("color", "Колір"), ("manuf", "Виробник")):
                        if v.startswith(pref):
                            header[key] = i
                continue
            if header is None or "price" not in header:
                continue
            price = cell(row, header["price"])
            name = text(cell(row, header.get("name", -1)))
            ref = text(cell(row, header.get("ref", -1)))
            if not name or money(price) is None:
                continue
            sku = ref or name
            manuf = text(cell(row, header.get("manuf", -1)))
            color = text(cell(row, header.get("color", -1)))
            pbrand = {"Extherm": "extherm", "Easytherm": "easytherm"}.get(manuf, brand)
            low = name.lower()
            if section and (low.startswith("нагрівальний мат") or low.startswith("кабель нагрівальний")):
                power = num(cell(row, header.get("power", -1)))
                if section["mat"]:
                    area = num(cell(row, header.get("area", -1)))
                    cat = "pid-laminat" if section["foil"] else "nahrivalni-maty"
                    tags = ["pid-laminat"] if section["foil"] else ["pid-plytku"]
                    tags += ["odnozhylnyi" if section["cores"] == "одножильний" else "dvozhylnyi", power_tag_m2(section["density"])]
                    if section["thin"]:
                        tags.append("ultratonkyi")
                    nm = f"Нагрівальний мат {bn} {ref} — {fmt(area)} м², {fmt(power)} Вт ({fmt(section['density'])} Вт/м²)" + (" у фользі" if section["foil"] else "")
                    specs = [sp("power_w", power), sp("area_m2", area), sp("power_w_m2", section["density"]), sp("cores", section["cores"])]
                    short = ("Нагрівальний мат у фользі для сухого монтажу під ламінат." if section["foil"] else
                             f"{'Одножильний' if section['cores'] == 'одножильний' else 'Двожильний'} мат {fmt(section['density'])} Вт/м² для укладання в плитковий клей.")
                else:
                    length = num(cell(row, header.get("length", -1)))
                    cat = "antyobledeninnia" if section["outdoor"] else "nahrivalnyi-kabel"
                    tags = (["vodostoky-ta-pokrivlia", "vidkryti-maidanchyky"] if section["outdoor"] else ["u-stiazhku"]) + ["dvozhylnyi", power_tag_m(section["linear"])]
                    nm = f"Нагрівальний кабель {bn} {ref} — {fmt(length)} м, {fmt(power)} Вт ({fmt(section['linear'])} Вт/м)"
                    specs = [sp("power_w", power), sp("length_m", length), sp("power_w_m", section["linear"]), sp("cores", section["cores"])]
                    short = ("Двожильний кабель 30 Вт/м для зовнішньої установки: сходи, доріжки, водостоки." if section["outdoor"] else
                             f"Двожильний кабель {fmt(section['linear'])} Вт/м для укладання в стяжку" + (" та плитковий клей." if section["linear"] and section["linear"] <= 18 else "."))
                if section["diam"]:
                    specs.append(sp("cable_diameter_mm", section["diam"]))
                if insulation:
                    m_in = re.search(r"Внутрішня ізоляція\s*[–-]\s*([^,;]+)", insulation)
                    m_out = re.search(r"зовнішня ізоляція\s*[–-]\s*([^,;.]+)", insulation, re.I)
                    if m_in:
                        specs.append(sp("inner_insulation", m_in.group(1).strip()))
                    if m_out:
                        specs.append(sp("outer_insulation", m_out.group(1).strip()))
                if warranty:
                    specs.append(sp("warranty", warranty))
                W.add(row=rn, sku=sku, name=nm, brand=pbrand, category=cat, tags=tags, price=price, specs=specs, short=short, sheet=ws.title)
                continue
            # терморегулятори, датчики, саморег, аксесуари, гумовий мат
            specs = [sp("color", color) if color and color != "-" else None, sp("warranty", warranty) if warranty else None]
            if re.search(r"термостат|терморегулятор", low):
                outdoor = "сніготан" in low
                cat = "antyobledeninnia" if outdoor else "termorehuliatory"
                tags = ["din-reika", "dlia-snihotanennia"] if outdoor else _thermostat_tags(name)
                if not outdoor and "wi-fi" not in tags and re.search(r"wifi", low):
                    tags.append("wi-fi")
                if not outdoor:
                    tags.append("datchyk-pidlohy")
                    m_w = re.search(r"(\d{4})\s*Вт", name)
                    specs.append(sp("max_load_a", "16", 16.0))
                    if m_w:
                        specs.append(spec("max_power_w", "Макс. потужність навантаження", m_w.group(1), float(m_w.group(1)), "Вт"))
                W.add(row=rn, sku=sku, name=name, brand=pbrand, category=cat, tags=tags, price=price, specs=specs, sheet=ws.title)
            elif low.startswith("кабель саморегулюючий"):
                w = re.search(r"SR\s*(\d+)", name)
                W.add(row=rn, sku=sku, name=name + (f" — {w.group(1)} Вт/м" if w else ""), brand=pbrand, category="samorehuliuiuchyi-kabel",
                      tags=["truby", "vodostoky-ta-pokrivlia", "vidriznyi"], price=price, unit="м",
                      specs=[sp("power_w_m", float(w.group(1))) if w else None], short="Ціна за погонний метр.", sheet=ws.title)
            elif low.startswith("гумовий нагрівальний мат"):
                W.add(row=rn, sku=sku, name=name, brand=pbrand, category="kylymky-z-pidihrivom", tags=["vidkryti-maidanchyky", "dlia-domu"], price=price,
                      specs=specs, short="Гумовий мат вуличного застосування: ґанок, сходи, вхідна група.", sheet=ws.title)
            elif low.startswith("датчик"):
                outdoor = "сніготан" in low
                W.add(row=rn, sku=sku, name=name, brand=pbrand, category="antyobledeninnia" if outdoor else "montazh-ta-aksesuary",
                      tags=["vodostoky-ta-pokrivlia"] if outdoor else ["datchyk-pidlohy"], price=price, specs=specs, sheet=ws.title)
            else:
                unit = "м" if re.search(r",\s*1\s*м$", name) else "шт"
                tags = ["vodostoky-ta-pokrivlia"] if re.search(r"водост|лотк", low) else []
                W.add(row=rn, sku=sku, name=name, brand=pbrand, category="montazh-ta-aksesuary", tags=tags, price=price, unit=unit, specs=specs, sheet=ws.title)
    W.flush()


# ---------------------------------------------------------------------------
# 7. Shtoller (docx)
# ---------------------------------------------------------------------------


def parse_shtoller():
    import docx

    W = Writer("shtoller", "Shtoller / Ecotherm (прайс 10.09.2025)", "2025-09-10-shtoller.docx", "2025-09-10")
    d = docx.Document(PRICES / W.file)
    tables = d.tables
    paras = [p.text.strip() for p in d.paragraphs if p.text.strip()]
    mat_title = next((p for p in paras if "мати" in p.lower()), "")
    cab_title = next((p for p in paras if "кабель" in p.lower()), "")

    def specs_from(table):
        out = []
        seen = set()
        for r in table.rows:
            t = r.cells[0].text.strip()
            if not t or t in seen:
                continue
            seen.add(t)
            m = re.match(r"^(.*?)\s*-\s*(.+)$", t)
            if not m:
                continue
            label, val = m.group(1).strip(), m.group(2).strip()
            slug = {
                "Матеріал внутрішньої ізоляції": "inner_insulation", "Матеріал зовнішньої ізоляції": "outer_insulation",
                "Матеріал захистного екрану": "screen", "Довжина холодного кінца": "cold_lead_m", "Діаметр нагрівального кабелю": "cable_diameter_mm",
                "Максимальна робоча температура зовнішньої оболонки": "max_temp",
            }.get(label)
            if slug in S:
                out.append(sp(slug, num(val) if S[slug][1] else val))
            elif slug:
                out.append(spec(slug, label, val))
        return out

    mat_specs = specs_from(tables[0])
    for r in tables[1].rows[1:]:
        sku, area, price = (c.text.strip() for c in r.cells[:3])
        a = num(area)
        power = round(a * 180) if a else None
        W.add(sku=sku, name=f"Нагрівальний мат Shtoller Ecotherm {sku} — {fmt(a)} м², {power} Вт (180 Вт/м²)", brand="shtoller",
              category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "180-vt-m2"], price=price,
              specs=[sp("power_w", float(power)), sp("area_m2", a), sp("power_w_m2", 180.0), sp("cores", "двожильний"), sp("voltage_v", "230", 230.0), *mat_specs],
              short=mat_title, sheet="Мати Ecotherm")
    cab_specs = specs_from(tables[2])
    for r in tables[3].rows[1:]:
        sku, length, price = (c.text.strip() for c in r.cells[:3])
        L = num(length)
        power = round(L * 20) if L else None
        W.add(sku=sku, name=f"Нагрівальний кабель Shtoller Ecotherm {sku} — {fmt(L)} м, {power} Вт (20 Вт/м)", brand="shtoller",
              category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "20-vt-m"], price=price,
              specs=[sp("power_w", float(power)), sp("length_m", L), sp("power_w_m", 20.0), sp("cores", "двожильний"), sp("voltage_v", "230", 230.0), *cab_specs],
              short=cab_title, sheet="Кабель Ecotherm")
    W.flush()


# ---------------------------------------------------------------------------
# 8. Magnum та інші з PDF «ПРАЙС 2026 ТП»
# ---------------------------------------------------------------------------

EUR = 53.0


def _pdf_lines(path: Path) -> list[tuple[int, str]]:
    import pdfplumber

    out = []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages, 1):
            words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
            rows: dict[int, list] = {}
            for w in words:
                rows.setdefault(round(w["top"] / 3), []).append(w)
            for key in sorted(rows):
                ws = sorted(rows[key], key=lambda w: w["x0"])
                out.append((pi, " ".join(w["text"] for w in ws)))
    return out


MAGNUM_MAT_SPECS = [sp("power_w_m2", 150.0), sp("cable_diameter_mm", 3.0), sp("inner_insulation", "PTFE"), sp("outer_insulation", "PVC, екран — алюміній"),
                    sp("voltage_v", "230", 230.0), sp("certification", "VDE"), sp("warranty", "20 років"), sp("connection", "муфтове"), sp("cores", "двожильний")]
MAGNUM_SLIM_SPECS = [sp("cable_diameter_mm", 3.5), sp("inner_insulation", "PTFE"), sp("outer_insulation", "PVC, екран — алюміній"), sp("voltage_v", "230", 230.0),
                     sp("certification", "VDE"), sp("warranty", "20 років"), sp("connection", "муфтове"), sp("cores", "двожильний")]
MAGNUM_CF_SPECS = [sp("power_w_m", 17.0), sp("cable_diameter_mm", 7.0), sp("inner_insulation", "XLPE"), sp("outer_insulation", "PVC, суцільна алюмінієва оболонка"),
                   sp("voltage_v", "230", 230.0), sp("certification", "VDE"), sp("warranty", "20 років"), sp("connection", "безмуфтове (лазерне зварювання)"), sp("cores", "двожильний")]
MAGNUM_HC_SPECS = [sp("power_w_m", 30.0), sp("cable_diameter_mm", 7.0), sp("inner_insulation", "PTFE"), sp("outer_insulation", "PVC"), sp("voltage_v", "230", 230.0),
                   sp("warranty", "10 років"), sp("connection", "безмуфтове"), sp("cores", "двожильний")]
MAGNUM_ALU_SPECS = [sp("power_w_m2", 140.0), sp("cable_diameter_mm", 2.0), sp("voltage_v", "230", 230.0), sp("cold_lead_m", 5.0), sp("power_w_m", 10.5),
                    sp("warranty", "10 років"), sp("cores", "двожильний")]
MHW_MAT_SPECS = [sp("power_w_m2", 150.0), sp("cable_diameter_mm", 3.6), sp("inner_insulation", "FEP"), sp("outer_insulation", "PVC, екран — алюміній"),
                 sp("voltage_v", "230", 230.0), sp("cold_lead_m", 2.5), sp("connection", "муфтове"), sp("cores", "двожильний"), sp("mat_width_m", 0.5)]
HW_CABLE_SPECS = [sp("power_w_m", 20.0), sp("cable_diameter_mm", 4.8), sp("inner_insulation", "FEP"), sp("outer_insulation", "PVC, екран — алюміній"),
                  sp("voltage_v", "230", 230.0), sp("cold_lead_m", 2.5), sp("connection", "муфтове"), sp("warranty", "20 років"), sp("cores", "двожильний")]


def parse_magnum():
    W = Writer("magnum-tp", "Прайс «ТП 2026» (Magnum, MHW, Terneo, EcoTerm, Castle), курс € = 53", "2026-magnum-tp.pdf", "2026-01-01")
    lines = _pdf_lines(PRICES / W.file)
    # склеюємо рядки, які PDF розбив: назва без чисел + наступний рядок з артикулом/числами
    joined: list[tuple[int, str]] = []
    i = 0
    while i < len(lines):
        p, t = lines[i]
        if i + 1 < len(lines) and re.match(r"^(MAGNUM Cable C&F-\d+W|Секция HW 20-\d+)$", t.strip()):
            joined.append((p, t + " " + lines[i + 1][1]))
            i += 2
            continue
        if re.match(r"^\d{3,4}$", t.strip()) and i + 1 < len(lines) and re.match(r"^MAGNUM", lines[i + 1][1]):
            joined.append((p, t + " " + lines[i + 1][1]))
            i += 2
            continue
        if re.match(r"^MAGNUM", t) and i + 1 < len(lines) and re.match(r"^\d{3,4}$", lines[i + 1][1].strip()):
            joined.append((p, lines[i + 1][1] + " " + t))
            i += 2
            continue
        joined.append((p, t))
        i += 1

    def n(s):
        return num(s.replace(",", "."))

    for page, t in joined:
        m = re.match(r"^(\d{3}) MAGNUM Mat ([\d,]+) m² (\d+) / (\d+) [\d,]+ ([\d,]+) (\d+) Magnum Standart Control\(механічний\) ([\d,]+) (\d+)", t)
        if m:
            art, area, power, ohm, eur, uah, kit_eur, kit_uah = m.groups()
            _magnum_mat(W, page, art, n(area), n(power), n(ohm), int(uah), int(kit_uah))
            continue
        m = re.match(r"^(\d{4}) MAGNUM Slim Cable 3,5 mm\.? ([\d,]+)m(?: \((18,5) Watt\))? [\d,]+ (\d+) ([\d,]+) ([\d,]+) (\d+)", t)
        if m:
            art, length, w185, power, area, eur, uah = m.groups()
            linear = 18.5 if w185 else 15.7
            W.add(sku=f"Slim Cable {length}m", name=f"Нагрівальний кабель Magnum Slim Cable 3,5 мм — {length} м, {power} Вт ({fmt(linear)} Вт/м)", brand="magnum",
                  category="nahrivalnyi-kabel", tags=["pid-plytku", "tonkyi-kabel", "dvozhylnyi"], price=int(uah), page=page,
                  specs=[sp("power_w", n(power)), sp("length_m", n(length)), sp("area_m2", n(area)), sp("power_w_m", linear), *MAGNUM_SLIM_SPECS],
                  short="Тонкий двожильний кабель Magnum 3,5 мм для укладання в плитковий клей (крок 10 см). Виробник C&F Technics, Нідерланди.",
                  price_note=f"Арт. {art}; ціна за курсом € = {int(EUR)}")
            continue
        m = re.match(r"^(\d{4}) MAGNUM Cable C&F-(\d+)W (\d+) ?/ ?(\d+) ([\d,]+)(?: ([\d,]+) ([\d,]+) ([\d,]+))? ([\d,]+) (\d+)", t)
        if m:
            art, power, _p, ohm, length, a1, a2, a3, eur, uah = m.groups()
            W.add(sku=f"C&F-17 {power}W", name=f"Нагрівальний кабель Magnum C&F-17 — {length} м, {power} Вт (17 Вт/м)", brand="magnum",
                  category="nahrivalnyi-kabel", tags=["u-stiazhku", "dvozhylnyi", "17-vt-m", "bezmuftove-ziednannia"], price=int(uah), page=page,
                  specs=[sp("power_w", n(power)), sp("length_m", n(length)), sp("resistance_ohm", n(ohm)),
                         sp("area_range_m2", f"{a1} – {a3}") if a1 else None, *MAGNUM_CF_SPECS],
                  short="Секція двожильного кабелю Magnum C&F-17 для укладання в стяжку 3,5–5 см. Безмуфтове з’єднання лазерним зварюванням.",
                  price_note=f"Арт. {art}; ціна за курсом € = {int(EUR)}")
            continue
        m = re.match(r"^(\d{3}) MAGNUM Cable ?C&F HC 30/(\d+)/(\d+) (\d+) (\d+) ?/ ?(\d+) ([\d,]+) (\d+)", t)
        if m:
            art, power, length, _l, _p, ohm, eur, uah = m.groups()
            W.add(sku=f"C&F HC 30/{power}/{length}", name=f"Нагрівальний кабель Magnum MHCX-30 — {length} м, {power} Вт (30 Вт/м)", brand="magnum",
                  category="antyobledeninnia", tags=["vodostoky-ta-pokrivlia", "vidkryti-maidanchyky", "dvozhylnyi", "30-vt-m", "bezmuftove-ziednannia"],
                  price=int(uah), page=page, specs=[sp("power_w", n(power)), sp("length_m", n(length)), sp("resistance_ohm", n(ohm)), *MAGNUM_HC_SPECS],
                  short="Двожильний кабель 30 Вт/м для обігріву покрівлі, водостоків, сходів, доріжок і відкритих площ.",
                  price_note=f"Арт. {art}; ціна за курсом € = {int(EUR)}")
            continue
        m = re.match(r"^(\d{4}) MAGNUM Aluminium Mat ([\d,]+) m² (\d+) / (\d+) [\d,]+ ([\d,]+) (\d+)", t)
        if m:
            art, area, power, ohm, eur, uah = m.groups()
            W.add(sku=f"Aluminium Mat {fmt(n(area)).replace(',', '.')}m2", name=f"Алюмінієвий мат Magnum Aluminium Mat 140 Вт/м² — {fmt(n(area))} м², {power} Вт", brand="magnum",
                  category="pid-laminat", tags=["pid-laminat", "aliuminiievyi-mat", "140-vt-m2"], price=int(uah), page=page,
                  specs=[sp("power_w", n(power)), sp("area_m2", n(area)), sp("resistance_ohm", n(ohm)), *MAGNUM_ALU_SPECS],
                  short="Алюмінієвий мат для сухого монтажу під ламінат і паркетну дошку.", price_note=f"Арт. {art}; ціна за курсом € = {int(EUR)}")
            continue
        m = re.match(r"^MНW150-(\d+)-([\d.]+) ([\d,]+) x ([\d,]+) (\d+) ([\d,]+) ([\d,]+) ([\d,]+)(?: (\d+))?", t)
        if m:
            _p, area_code, w, l, power, _area, eur, kit_eur, kit_uah = m.groups()
            area = n(area_code)
            sku = f"MHW150-{power}-{area_code}"
            W.add(sku=sku, name=f"Нагрівальний мат MHW {sku} — {fmt(area)} м², {power} Вт (150 Вт/м²)", brand="mhw", category="nahrivalni-maty",
                  tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=round(n(eur) * EUR), kit=round(n(kit_eur) * EUR), page=page,
                  specs=[sp("power_w", n(power)), sp("area_m2", area), sp("size_m", f"{w} x {l}"), *MHW_MAT_SPECS],
                  short="Двожильний екранований мат 150 Вт/м², Ø 3,6 мм, для плиткового клею. Комплект — з терморегулятором за вибором.",
                  price_note=f"Ціна {eur} € за курсом {int(EUR)}")
            continue
        m = re.match(r"^Секция HW 20-(\d+) ([\d,]+) (\d+) [^ ]+ [^ ]+ ([\d,]+) ([\d,]+) (\d+)", t)
        if m:
            power, length, _p, eur, kit_eur, kit_uah = m.groups()
            W.add(sku=f"HW 20-{power}", name=f"Нагрівальний кабель MHW HW 20-{power} — {length} м, {power} Вт (20 Вт/м)", brand="mhw", category="nahrivalnyi-kabel",
                  tags=["u-stiazhku", "dvozhylnyi", "20-vt-m"], price=round(n(eur) * EUR), kit=round(n(kit_eur) * EUR), page=page,
                  specs=[sp("power_w", n(power)), sp("length_m", n(length)), *HW_CABLE_SPECS],
                  short="Секція двожильного екранованого кабелю 20 Вт/м, Ø 4,8 мм, для укладання в стяжку або плитковий клей.",
                  price_note=f"Ціна {eur} € за курсом {int(EUR)}")
            continue

    # Рядки, які PDF видає з «розсипаними» літерами, — переписані вручну з прайсу
    _magnum_mat(W, 1, "491", 0.75, 113, 468, 6890, 9540)
    _magnum_mat(W, 1, "492", 1.0, 150, 353, 4611, 7261)

    sr = [sp("voltage_v", "220–240", None), sp("warranty", "5 років"), spec("manufacturer", "Виробник", "HTS Global Technologies GmbH (Швейцарія)")]
    W.add(sku="28TTL2-BO", name="Саморегулюючий кабель HTS 28TTL2-BO будівельного та промислового класу — 28 Вт/м", brand="hts-global",
          category="samorehuliuiuchyi-kabel", tags=["truby", "vodostoky-ta-pokrivlia", "vidriznyi", "28-vt-m"], price=795, unit="м", page=1,
          specs=[sp("power_w_m", 28.0), *sr], short="28 Вт/м при +10 °C, стійкий до УФ, мін. температура монтажу −50 °C.", price_note=f"Арт. 2025; 15,00 €/м за курсом {int(EUR)}")
    W.add(sku="eHeat Micro", name="Саморегулюючий кабель HTS eHeat Micro — 17 Вт/м", brand="hts-global", category="samorehuliuiuchyi-kabel",
          tags=["truby", "vidriznyi", "17-vt-m"], price=583, unit="м", page=1, specs=[sp("power_w_m", 17.0), *sr],
          short="Стрічковий саморегулюючий кабель 17 Вт/м при +10 °C з екраном з алюмінієвої фольги.", price_note=f"Арт. 2027; 11,00 €/м за курсом {int(EUR)}")
    W.add(sku="Комплект муфт саморег", name="Комплект муфт на саморегулюючий кабель (з роботою)", brand=None, category="montazh-ta-aksesuary",
          tags=["truby"], price=705, page=1, price_note="Арт. 2026")

    for art, sku, name, eur, tags in (
        ("1571", "Standard Control", "Терморегулятор Magnum Standard Control (механічний)", 77, ["mekhanichnyi", "datchyk-pidlohy"]),
        ("1582", "Intelligent Control", "Терморегулятор Magnum Intelligent Control (програмований)", 88, ["prohramovanyi", "tsyfrovyi", "datchyk-pidlohy"]),
        ("1584", "F32 Smart WiFi", "Терморегулятор Magnum F32 Smart WiFi (чорний / білий)", 140, ["prohramovanyi", "sensornyi", "wi-fi", "datchyk-pidlohy"]),
        ("1587", "ET44 WiFi", "Терморегулятор Magnum ET44 WiFi (білий / чорний) — новинка", 87, ["prohramovanyi", "wi-fi", "datchyk-pidlohy"]),
    ):
        W.add(sku=sku, name=name, brand="magnum", category="termorehuliatory", tags=tags, price=round(eur * EUR), page=2,
              specs=[sp("max_load_a", "16", 16.0)], price_note=f"Арт. {art}; {eur},00 € за курсом {int(EUR)}")
    W.add(sku="ETOR-55", name="Датчик вологи для ринви OJ Electronics ETOR-55 (кабель 10 м)", brand="oj-electronics", category="antyobledeninnia",
          tags=["vodostoky-ta-pokrivlia", "pid-zamovlennia"], price=19186, page=2, price_note=f"Арт. 2018; під замовлення; 362,00 € за курсом {int(EUR)}",
          short="Встановлюється в жолобі або водостічній трубі, реєструє наявність вологи. Працює з ETR2/ETO2.")
    W.add(sku="ETF-633/44/55", name="Трубний датчик температури OJ Electronics ETF-633/44/55", brand="oj-electronics", category="antyobledeninnia",
          tags=["truby", "pid-zamovlennia"], price=3445, page=2, price_note=f"Арт. 2023; під замовлення; 65,00 € за курсом {int(EUR)}")

    for brand, sku, name, price, tags, short in (
        ("terneo", "terneo mex", "Терморегулятор Terneo mex (механічний)", 962, ["mekhanichnyi", "datchyk-pidlohy"], "16 А, 3000 ВА, 10…40 °C, датчик R10-3. Зберігає налаштування при вимкненні."),
        ("terneo", "terneo st", "Терморегулятор Terneo st (цифровий)", 1268, ["tsyfrovyi", "datchyk-pidlohy"], "16 А, 3000 ВА, 5…40 °C, датчик R10-3. Найбільш затребувана модель."),
        ("terneo", "terneo sx", "Терморегулятор Terneo sx (Wi-Fi, сенсорний)", 2666, ["prohramovanyi", "sensornyi", "wi-fi", "datchyk-pidlohy"], "16 А, 3000 ВА, 5…45 °C. Керування зі смартфона."),
        ("ecoterm", "ECOTERM MEX", "Терморегулятор EcoTerm MEX (механічний)", 1050, ["mekhanichnyi", "datchyk-pidlohy"], "16 А / 3500 Вт, +5…+45 °C, з виносним датчиком."),
        ("ecoterm", "EcoTerm LED", "Терморегулятор EcoTerm LED (сенсорний, програмований)", 1500, ["prohramovanyi", "sensornyi", "datchyk-pidlohy", "datchyk-povitria"], "16 А / 3500 Вт, два датчики: підлоги і повітря."),
        ("ecoterm", "EcoTerm LED WIFI", "Терморегулятор EcoTerm LED WIFI (сенсорний, Wi-Fi)", 2100, ["prohramovanyi", "sensornyi", "wi-fi", "datchyk-pidlohy", "datchyk-povitria"], "16 А / 3500 Вт, керування по Wi-Fi для iOS і Android."),
        ("ecoterm", "EcoTerm SN", "Програматор EcoTerm SN (сенсорний)", 2500, ["prohramovanyi", "sensornyi", "datchyk-pidlohy", "datchyk-povitria"], "16 А / 3500 Вт, два датчики: підлоги і повітря."),
        ("ecoterm", "EcoTerm SN WI-FI", "Програматор EcoTerm SN WI-FI (сенсорний, Wi-Fi)", 3650, ["prohramovanyi", "sensornyi", "wi-fi", "datchyk-pidlohy", "datchyk-povitria"], "16 А / 3500 Вт, керування по Wi-Fi."),
        ("castle", "RTC-70", "Терморегулятор Castle RTC-70 (механічний, білий / чорний)", 550, ["mekhanichnyi", "datchyk-pidlohy"], None),
        ("castle", "AC8400H", "Програматор Castle AC8400H (сенсорний, чорний / срібний)", 1500, ["prohramovanyi", "sensornyi", "datchyk-pidlohy"], "Версія з Wi-Fi — 2500 грн."),
        ("castle", "AC8400H WiFi", "Програматор Castle AC8400H Wi-Fi (сенсорний, чорний / срібний)", 2500, ["prohramovanyi", "sensornyi", "wi-fi", "datchyk-pidlohy"], None),
        ("castle", "AC602H", "Програматор Castle AC602H (білий / чорний)", 1500, ["prohramovanyi", "datchyk-pidlohy"], "Версія з Wi-Fi — 2500 грн."),
        ("castle", "AC602H WiFi", "Програматор Castle AC602H Wi-Fi (білий / чорний)", 2500, ["prohramovanyi", "wi-fi", "datchyk-pidlohy"], None),
    ):
        W.add(sku=sku, name=name, brand=brand, category="termorehuliatory", tags=tags, price=price, page=4, short=short,
              specs=[sp("max_load_a", "16", 16.0)], price_note="наявність уточнюйте" if brand == "terneo" else None)
    W.flush()


def _magnum_mat(W, page, art, area, power, ohm, uah, kit_uah):
    W.add(sku=f"Mat {fmt(area).replace(',', '.')}m2", name=f"Нагрівальний мат Magnum Mat 150 Вт/м² — {fmt(area)} м², {int(power)} Вт", brand="magnum",
          category="nahrivalni-maty", tags=["pid-plytku", "dvozhylnyi", "150-vt-m2"], price=uah, kit=kit_uah, page=page,
          specs=[sp("power_w", float(power)), sp("area_m2", float(area)), sp("resistance_ohm", float(ohm)), *MAGNUM_MAT_SPECS],
          short="Двожильний мат Magnum 150 Вт/м² для плиткового клею. Комплект = мат + терморегулятор Magnum Standart Control. Виробник C&F Technics, Нідерланди.",
          price_note=f"Арт. {art}; ціна за курсом € = {int(EUR)}")


# ---------------------------------------------------------------------------

PARSERS = {
    "heat-plus": parse_heat_plus,
    "ar-ryxon-flex": parse_ar_ryxon_flex,
    "in-therm": parse_in_therm,
    "smart": parse_smart,
    "rd": parse_rd,
    "easytherm-extherm": parse_easytherm,
    "shtoller": parse_shtoller,
    "magnum-tp": parse_magnum,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="лише один постачальник: " + ", ".join(PARSERS))
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for key, fn in PARSERS.items():
        if args.only and key != args.only:
            continue
        fn()
    for d in OUT.iterdir():
        if d.is_dir():
            total += len(list(d.glob("*.json")))
    print(f"Разом файлів товарів: {total}")


if __name__ == "__main__":
    main()
