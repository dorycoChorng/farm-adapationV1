"""
Builds src/data/ecocrop.json, the crop catalogue bundled with the app, from the full FAO
ECOCROP database as published by the OpenCLIM project (UK Centre for Ecology & Hydrology):
EcoCrop_DB.csv in https://github.com/OpenCLIM/ecocrop (Brown, Redhead, Pywell and Price,
doi:10.5281/zenodo.10843625; Open Government Licence v3). The CSV is not committed;
download the pinned version with:

  curl -LO https://raw.githubusercontent.com/OpenCLIM/ecocrop/f13577f4237604b15d85d8e43741714a2d1eb2d4/EcoCrop_DB.csv
  python3 scripts/build-crops.py EcoCrop_DB.csv

Which crops: the food crops listed in scripts/data/crop-selection.json (app id and FAO
EcoCrop code), chosen from ECOCROP's food categories and main uses with complete
temperature, rainfall and pH ranges. Values are copied unchanged from the CSV.

English names come from scripts/data/ecocrop-english-names.json (ECOCROP's English common
names, from the R package dismo); curated English and Khmer names for well-known crops
from scripts/data/crop-names.json.
"""
import json
import re
import sys
from pathlib import Path

import csv

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
    try:
        return float(v)
    except (TypeError, ValueError):
        return None  # empty or "NA"


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
    selection = json.loads((ROOT / "scripts/data/crop-selection.json").read_text())["crops"]
    # The OpenCLIM CSV is Windows-1252 encoded.
    with open(src, encoding="cp1252", errors="replace", newline="") as f:
        rows = {r["EcoPortCode"].strip(): r for r in csv.DictReader(f)}
    out, missing_codes = [], []
    for cid, code in selection:
        d = rows.get(str(code))
        if d is None:
            missing_codes.append(code)
            continue
        sci = d["ScientificName"].strip()
        cats = [c.strip() for c in d.get("CAT", "").split(",")]
        cat = next((short for long, short in FOOD_CATEGORIES if long in cats), None)
        curated = names.get(sci)
        temp = rng(d, "TMIN", "TOPMN", "TOPMX", "TMAX")
        rain = rng(d, "RMIN", "ROPMN", "ROPMX", "RMAX")
        ph = rng(d, "PHMIN", "PHOPMN", "PHOPMX", "PHMAX")
        if not (temp and rain and ph):
            missing_codes.append(code)
            continue
        common, lower = [], set()
        # Alphabetical, as in FAO's own export, so the fallback English name is stable.
        for n in sorted(d.get("COMNAME", "").split(","), key=lambda x: x.strip().lower()):
            n = n.strip()
            if NAME_OK.match(n) and n.lower() not in lower:
                lower.add(n.lower())
                common.append(n)
        cmin, cmax = num(d.get("GMIN")), num(d.get("GMAX"))
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
            int(code),
            1 if curated else 0,
        ])
    out.sort(key=lambda c: (not c[11], c[3] is None, (c[3] or c[1]).lower()))
    doc = {
        "source": "FAO ECOCROP database, EcoCrop_DB.csv from OpenCLIM/ecocrop (UKCEH, doi:10.5281/zenodo.10843625, Open Government Licence v3)",
        "fields": ["id", "scientific", "category", "en", "km", "names", "temp", "rain", "ph", "cycleDays", "ecocropId", "known"],
        "crops": out,
    }
    target = ROOT / "src/data/ecocrop.json"
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(out)} crops written, {target.stat().st_size // 1024} KiB")
    if missing_codes:
        print("selected crops not found or incomplete in the CSV:", missing_codes)


if __name__ == "__main__":
    main(sys.argv[1])
