""""
Builds src/data/ecocrop.json, the crop catalogue bundled with the app, from the FAO
ECOCROP database export shipped in the `ecocrop` 0.2.0 package on PyPI
(data/Ecocrop_updated_1312023.xlsx). The export is not committed; download it with:

  curl -LO https://files.pythonhosted.org/packages/e6/49/21e41c36b7c705ce99ba7638278adb957abc3a9d859581afe0db16c9ec63/ecocrop-0.2.0.tar.gz
  tar xzf ecocrop-0.2.0.tar.gz
  python3 -m pip install openpyxl
  python3 scripts/build-crops.py ecocrop-0.2.0/data/Ecocrop_updated_1312023.xlsx

English names come from scripts/data/ecocrop-english-names.json (ECOCROP's English common
names, from the R package dismo); curated English and Khmer names for well-known crops
from scripts/data/crop-names.json.

Kept: every species ECOCROP lists as a food crop (cereals, pulses, roots and tubers,
vegetables, fruits and nuts, or main use food/beverage/food additive) with complete
temperature, rainfall and pH ranges. Values are copied unchanged.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
FOOD_CATEGORIES = [
    ("cereals & pseudocereals", "cereals"),
    ("pulses (grain legumes)", "pulses"),
    ("roots/tubers", "roots"),
    ("vegetables", "vegetables"),
    ("fruits & nuts", "fruits"),
]
FOOD_USES = {"food & beverage", "food additive"}
NAME_OK = re.compile(r"^[A-Za-zÀ-ÿ' .()\-]{2,40}$")


def num(v):
    return float(v) if isinstance(v, (int, float)) else None


def rng(d, a_min, o_min, o_max, a_max):
    vals = [num(d[k]) for k in (a_min, o_min, o_max, a_max)]
    if any(v is None for v in vals):
        return None
    if not (vals[0] <= vals[1] <= vals[2] <= vals[3]):
        return None
    return vals


def name_key(scientific, infra=True):
    """Genus, species and (optionally) variety/subspecies, without the author."""
    w = re.sub(r"[^A-Za-z .-]", " ", scientific).split()
    key = w[:2]
    if infra:
        for i, t in enumerate(w[2:-1], start=2):
            if t.rstrip(".") in ("var", "ssp", "subsp", "v"):
                key += ["var", w[i + 1]]
                break
    return " ".join(key).lower()


ENGLISH_WORDS = re.compile(
    r"\b(tree|bean|pea|palm|fruit|nut|grass|plum|cherry|apple|pepper|gourd|melon|yam|potato|berry|"
    r"leaf|root|cabbage|spinach|onion|millet|rice|wheat|lime|orange|lemon|fig|grape|olive|date|"
    r"kale|mustard|cress|sorrel|garlic|ginger|mint|basil|tea|coffee|cocoa|vine|lettuce|squash|"
    r"pumpkin|cucumber|tomato|radish|turnip|carrot|celery|bamboo|sugar|oil|seed|corn|oat|barley)s?\b",
    re.I,
)


def likely_english(common):
    """The first ECOCROP common name that reads as English (ECOCROP lists names from many languages, unlabelled)."""
    for n in common:
        if ENGLISH_WORDS.search(n) and not re.search(r"\(", n):
            return n[:1].upper() + n[1:]
    return None


def english_names():
    """ECOCROP's English common name for each species (from the R package dismo's ECOcrops table)."""
    table = json.loads((ROOT / "scripts/data/ecocrop-english-names.json").read_text())["names"]
    exact, species = {}, {}
    for sci, name in table.items():
        exact.setdefault(name_key(sci), name)
        species.setdefault(name_key(sci, infra=False), name)
    return lambda sci: exact.get(name_key(sci)) or species.get(name_key(sci, infra=False))


def main(src):
    names = json.loads((ROOT / "scripts/data/crop-names.json").read_text())
    english = english_names()
    ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    out, skipped, seen_ids = [], 0, set()
    for r in rows[1:]:
        d = dict(zip(header, r))
        sci = (d.get("species") or "").strip()
        if not sci:
            continue
        cats = [c.strip() for c in str(d.get("Category") or "").split(",")]
        cat = next((short for long, short in FOOD_CATEGORIES if long in cats), None)
        use = str(d.get("use.main") or "")
        curated = names.get(sci)
        if not (cat or use in FOOD_USES or curated):
            continue
        temp = rng(d, "Temp_Abs_Min", "temp_opt_min", "Temp_Opt_Max", "Temp_Abs_Max")
        rain = rng(d, "Rain_Abs_Min", "Rain_Opt_Min", "Rain_Opt_Max", "Rain_Abs_Max")
        ph = rng(d, "pH_Abs_Min", "pH_Opt_Min", "pH_Opt_Max", "pH_Abs_Max")
        if not (temp and rain and ph):
            skipped += 1
            continue
        common, lower = [], set()
        for n in str(d.get("Common_names") or "").split(","):
            n = n.strip()
            if NAME_OK.match(n) and n.lower() not in lower:
                lower.add(n.lower())
                common.append(n)
        cid = curated["id"] if curated else f"ec-{int(d['crop_code'])}"
        if cid in seen_ids:
            continue
        seen_ids.add(cid)
        cmin, cmax = num(d.get("cycle_min")), num(d.get("cycle_max"))
        # Display name: curated, else ECOCROP's English name, else its first listed common name.
        en = (curated or {}).get("en") or english(sci) or likely_english(common)
        if en and en.lower() == sci.lower():
            en = None
        out.append([
            cid,
            sci,
            (curated or {}).get("category") or cat or "other",
            en,
            (curated or {}).get("km"),
            "|".join(common[:30]),
            temp,
            rain,
            ph,
            [cmin, cmax] if cmin and cmax and cmin > 0 and cmax >= cmin else None,
            int(d["crop_code"]),
            1 if curated else 0,
        ])
    missing = [s for s in names if not s.startswith("_") and s not in {c[1] for c in out}]
    out.sort(key=lambda c: (not c[11], c[3] is None, (c[3] or c[1]).lower()))
    doc = {
        "source": "FAO ECOCROP database, export Ecocrop_updated_1312023.xlsx from the ecocrop 0.2.0 package (PyPI)",
        "fields": ["id", "scientific", "category", "en", "km", "names", "temp", "rain", "ph", "cycleDays", "ecocropId", "known"],
        "crops": out,
    }
    target = ROOT / "src/data/ecocrop.json"
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(out)} crops written, {skipped} food crops skipped for incomplete ranges, "
          f"{target.stat().st_size // 1024} KiB")
    if missing:
        print("curated names not found in ECOCROP:", ", ".join(missing))


if __name__ == "__main__":
    main(sys.argv[1])
